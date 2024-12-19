import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as anchor from '@coral-xyz/anchor';
import {
  AnchorProvider,
  Program,
  setProvider,
  Wallet,
} from '@coral-xyz/anchor';
import type { DepositProgram } from './interfaces/deposit_program';
import { clusterApiUrl, Connection, Keypair, PublicKey } from '@solana/web3.js';
import 'dotenv/config';
import * as idl from './interfaces/deposit_program.json';
import { TOKEN_PROGRAM_ID } from '@coral-xyz/anchor/dist/cjs/utils/token';

@Injectable()
export class PaymentService implements OnModuleInit {
  private readonly acnhorProvider: AnchorProvider;
  private readonly connection: Connection;
  private readonly program: Program<DepositProgram>;
  private readonly walletForProvider: Wallet;
  private readonly master: Keypair;
  private readonly tokenProgram = TOKEN_PROGRAM_ID;
  private readonly tokenUSDC = new PublicKey(
    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  );
  // TODO: Replace with actual user keypair
  private readonly userKeypair: Keypair = new Keypair();

  constructor() {
    // Setup config
    this.master = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(process.env.MASTER_KEY ?? '')),
    );
    this.connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    this.walletForProvider = new Wallet(this.userKeypair);
    this.acnhorProvider = new AnchorProvider(
      this.connection,
      this.walletForProvider,
      AnchorProvider.defaultOptions(),
    );
    setProvider(this.acnhorProvider);
    this.program = new Program(idl as DepositProgram, this.acnhorProvider);
  }

  private async depositToTimedVault() {
    try {
      const transaction = await this.program.methods
        .depositToTimedVault(new anchor.BN(1_000_000))
        .accounts({
          user: this.userKeypair.publicKey,
          token: this.tokenUSDC,
          tokenProgram: this.tokenProgram,
        })
        .signers([this.userKeypair])
        .rpc();
      console.log(transaction);
    } catch (error) {
      console.log(`Error: ${error}`);
    }
  }

  private async payPerTime() {
    try {
      const transaction = await this.program.methods
        // TODO: Implement the function of converting to the correct format
        .payPerTime(new anchor.BN(1_000_000))
        .accounts({
          user: this.userKeypair.publicKey,
          token: this.tokenUSDC,
          tokenProgram: this.tokenProgram,
        })
        .signers([this.master])
        .rpc();
      console.log(transaction);
    } catch (error) {
      console.error(error);
    }
  }

  onModuleInit() {
    Logger.log('Payment Service initialized');
  }
}
