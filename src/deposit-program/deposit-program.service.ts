import * as anchor from '@coral-xyz/anchor';
import * as idl from './idl/deposit_program.json';
import {
  AnchorProvider,
  Program,
  setProvider,
  Wallet,
} from '@coral-xyz/anchor';
import { Injectable, Logger } from '@nestjs/common';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { DepositProgram } from './idl/deposit_program';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import 'dotenv/config';
import { DepositProgramAccountType } from 'src/deposit-program/constants/account-type.enum';
import { UnfreezeBalanceResponseDto } from './dto/unfreeze-balance-response.dto';
import { UserInfo } from './types/get-user-info.type';
import { SubscriptionPrice } from 'src/payment/constants/subscription-price.enum';

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
  private readonly SUBSCRIPTION_PRICE = new anchor.BN(
    SubscriptionPrice.PER_MONTH * 1_000_000, // raw USDC
  );
  private readonly SUBSCRIPTION_DURATION_SEC = new anchor.BN(30 * 24 * 60 * 60); // 30 day in seconds

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

  getUserInfoAddress(userPublicKey: string): PublicKey {
    const publicKey = new PublicKey(userPublicKey);
    const [userInfoAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from(DepositProgramAccountType.INFO), publicKey.toBuffer()],
      this.program.programId,
    );

    return userInfoAddress;
  }

  async getUserInfo(userInfoAddress: PublicKey): Promise<UserInfo> {
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

  async payPerMinute(userPublicKey: string, rawPrice: number): Promise<void> {
    const publicKey = new PublicKey(userPublicKey);

    const transaction = await this.program.methods
      .payPerMinuteAndUnfreezeBalance(new anchor.BN(rawPrice))
      .accounts({
        user: publicKey,
        token: this.TOKEN_ADDRESS,
        tokenProgram: this.TOKEN_PROGRAM,
      })
      .signers([this.master])
      .rpc();

    this.logger.debug(`Payment done: [${transaction}]`);
  }

  async payPerHour(
    userPublicKey: string,
    rawTotalPrice: number,
    perHoursLeft: number,
  ): Promise<void> {
    const publicKey = new PublicKey(userPublicKey);

    const transaction = await this.program.methods
      .payPerHourAndUnfreezeBalance(
        new anchor.BN(rawTotalPrice),
        new anchor.BN(perHoursLeft),
      )
      .accounts({
        user: publicKey,
        token: this.TOKEN_ADDRESS,
        tokenProgram: this.TOKEN_PROGRAM,
      })
      .signers([this.master])
      .rpc();

    this.logger.debug(`Payment done: [${transaction}]`);
  }

  async buySubscription(userPublicKey: string): Promise<void> {
    const publicKey = new PublicKey(userPublicKey);

    const transaction = await this.program.methods
      .subscribe(this.SUBSCRIPTION_PRICE, this.SUBSCRIPTION_DURATION_SEC)
      .accounts({
        user: publicKey,
        token: this.TOKEN_ADDRESS,
        tokenProgram: this.TOKEN_PROGRAM,
      })
      .signers([this.master])
      .rpc();

    this.logger.debug(`Payment done: [${transaction}]`);
  }

  async refundBalance(
    userPublicKey: string,
    rawTotalPrice: number,
  ): Promise<string> {
    const publicKey = new PublicKey(userPublicKey);

    const transaction = await this.program.methods
      .refund(rawTotalPrice)
      .accounts({
        user: publicKey,
        token: this.TOKEN_ADDRESS,
        tokenProgram: this.TOKEN_PROGRAM,
      })
      .signers([this.master])
      .rpc();

    this.logger.debug(
      `Refund done for user [${userPublicKey}], transaction: [${transaction}]`,
    );

    return transaction;
  }

  async freezeBalance(userPublicKey: string): Promise<string> {
    const publicKey = new PublicKey(userPublicKey);

    const transaction = await this.program.methods
      .freezeBalance()
      .accounts({
        user: publicKey,
      })
      .signers([this.master])
      .rpc();

    return transaction;
  }

  async unfreezeBalance(
    userPublicKey: string,
  ): Promise<UnfreezeBalanceResponseDto> {
    const publicKey = new PublicKey(userPublicKey);

    try {
      const transaction = await this.program.methods
        .unfreezeBalance()
        .accounts({
          user: publicKey,
        })
        .signers([this.master])
        .rpc();
      return { transaction };
    } catch (error) {
      this.logger.error(`Error unfreezing balance: [${error}]`);
    }
  }
}
