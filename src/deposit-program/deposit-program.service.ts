import {
  AnchorProvider,
  Program,
  setProvider,
  Wallet,
} from '@coral-xyz/anchor';
import { Injectable, Logger } from '@nestjs/common';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { DepositProgram } from './interfaces/deposit_program';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import * as idl from './interfaces/deposit_program.json';
import { AccountType } from 'src/payment/constants/account-type.enum';

@Injectable()
export class DepositProgramService {
  private readonly logger = new Logger(DepositProgramService.name);
  private readonly anchorProvider: AnchorProvider;
  private readonly connection: Connection;
  private readonly program: Program<DepositProgram>;
  private readonly anchorProviderWallet: Wallet;
  private readonly master: Keypair;
  private readonly TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
  private readonly TOKEN_ADDRESS = new PublicKey(process.env.TOKEN_ADDRESS);

  constructor() {
    // Setup program
    this.master = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(process.env.MASTER_KEY)),
    );
    this.connection = new Connection(process.env.RPC_URL, 'confirmed');
    this.anchorProviderWallet = new Wallet(this.master);
    this.anchorProvider = new AnchorProvider(
      this.connection,
      this.anchorProviderWallet,
      AnchorProvider.defaultOptions(),
    );
    setProvider(this.anchorProvider);
    this.program = new Program(idl as DepositProgram, this.anchorProvider);
  }

  getUserInfoAddress(
    infoAccountType: AccountType,
    userPublicKey: PublicKey,
  ): PublicKey {
    const [userInfoAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from(infoAccountType), userPublicKey.toBuffer()],
      this.program.programId,
    );
    return userInfoAddress;
  }

  async getUserInfo(userInfoAddress: PublicKey) {
    return await this.program.account.userInfo.fetch(userInfoAddress);
  }

  async getUserVaultBalance(userVaultAddress: PublicKey): Promise<number> {
    const balanceInfo =
      await this.connection.getTokenAccountBalance(userVaultAddress);
    const balance = parseInt(balanceInfo.value.amount);
    return balance;
  }

  async getUserVaultAddress(userInfoAddress: PublicKey): Promise<PublicKey> {
    return await getAssociatedTokenAddress(
      this.TOKEN_ADDRESS,
      userInfoAddress,
      true,
      this.TOKEN_PROGRAM,
    );
  }

  async payPerMinute(
    userPublicKey: PublicKey,
    rawPrice: number,
  ): Promise<void> {
    const transaction = await this.program.methods
      .payPerMinuteAndUnfreezeBalance(new anchor.BN(rawPrice))
      .accounts({
        user: userPublicKey,
        token: this.TOKEN_ADDRESS,
        tokenProgram: this.TOKEN_PROGRAM,
      })
      .signers([this.master])
      .rpc();
    this.logger.debug(`Payment done: [${transaction}]`);
  }

  async payPerHour(
    userPublicKey: PublicKey,
    rawTotalPrice: number,
    perHoursLeft: number,
  ): Promise<void> {
    const transaction = await this.program.methods
      .payPerHourAndUnfreezeBalance(
        new anchor.BN(rawTotalPrice),
        new anchor.BN(perHoursLeft),
      )
      .accounts({
        user: userPublicKey,
        token: this.TOKEN_ADDRESS,
        tokenProgram: this.TOKEN_PROGRAM,
      })
      .signers([this.master])
      .rpc();
    this.logger.debug(`Payment done: [${transaction}]`);
  }

  async refundBalance(
    userPublicKey: PublicKey,
    rawTotalPrice: number,
  ): Promise<string> {
    const transaction = await this.program.methods
      .refund(rawTotalPrice)
      .accounts({
        user: userPublicKey,
        token: this.TOKEN_ADDRESS,
        tokenProgram: this.TOKEN_PROGRAM,
      })
      .signers([this.master])
      .rpc();
    this.logger.debug(
      `Refund done for user [${userPublicKey.toString()}], transaction: [${transaction}]`,
    );
    return transaction;
  }

  async freezeBalance(userPublicKey: PublicKey): Promise<string> {
    const transaction = await this.program.methods
      .freezeBalance()
      .accounts({
        user: userPublicKey,
      })
      .signers([this.master])
      .rpc();
    return transaction;
  }

  async unfreezeBalance(userPublicKey: PublicKey): Promise<string> {
    try {
      const transaction = await this.program.methods
        .unfreezeBalance()
        .accounts({
          user: userPublicKey,
        })
        .signers([this.master])
        .rpc();
      return transaction;
    } catch (error) {
      this.logger.error(`Error unfreezing balance: [${error}]`);
    }
  }
}
