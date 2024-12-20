import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
import { Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import 'dotenv/config';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { get } from 'http';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { SchedulerRegistry } from '@nestjs/schedule';
import { start } from 'repl';

@Injectable()
export class PaymentService implements OnModuleInit {
  private readonly anchorProvider: AnchorProvider;
  private readonly connection: Connection;
  private readonly program: Program<DepositProgram>;
  private readonly AnchorProviderWallet: Wallet;
  private readonly master: Keypair;
  private readonly TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
  private readonly USDC_TOKEN_ADDRESS = new PublicKey(
    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  );
  private readonly USDC_PRICE_PER_MINUTE = 0.03 * 1_000_000; // 0.03 USDC in raw format
  // TODO: Replace with actual user keypair
  private readonly userKeypair: Keypair = new Keypair();

  constructor(
    private readonly jwtService: JwtService,
    private readonly schedulerRegistry: SchedulerRegistry,
    // cacheManager<key: string(publicKey), value: Date(StartTime)>
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    // Setup config
    this.master = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(process.env.MASTER_KEY ?? '')),
    );
    this.connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    this.AnchorProviderWallet = new Wallet(this.master);
    this.anchorProvider = new AnchorProvider(
      this.connection,
      this.AnchorProviderWallet,
      AnchorProvider.defaultOptions(),
    );
    setProvider(this.anchorProvider);
    this.program = new Program(idl as DepositProgram, this.anchorProvider);
  }

  onModuleInit() {
    Logger.log('Payment Service initialized');
  }

  private async startPayingPerTime(client: Socket) {
    try {
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      const [userInfoAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_timed_info'), userPublicKey.toBuffer()],
        this.program.programId,
      );
      const userAtaAddress: PublicKey = await getAssociatedTokenAddress(
        this.USDC_TOKEN_ADDRESS,
        userInfoAddress,
      );
      const userAtaBalance: number =
        await this.getUserAtaBalance(userAtaAddress);

      // Check if user has sufficient balance
      if (userAtaBalance < this.USDC_PRICE_PER_MINUTE) {
        throw new Error('Insufficient balance');
      }

      const usageStartTime: Date = new Date();
      // Store the usage start time in cache associated with the client's public key
      this.cacheManager.set(userPublicKey.toString(), usageStartTime);

      const usageTimeLimit: Date = this.getUsageTimeLimit(
        usageStartTime,
        userAtaBalance,
      );
      // TODO: Implement timeout for limited usage
      // setLimitedUsageTimeout(userPublicKey, usageStartTime, usageTimeLimit);
    } catch (error) {
      // Disconnect client if error occurs
      Logger.error(`Error starting pay per time: ${error.message}`);
      client._error(error);
    }
  }

  private async depositToTimedVault() {
    try {
      const transaction = await this.program.methods
        .depositToTimedVault(new anchor.BN(1_000_000))
        .accounts({
          user: this.userKeypair.publicKey,
          token: this.USDC_TOKEN_ADDRESS,
          tokenProgram: this.TOKEN_PROGRAM,
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
        .payPerTime(new anchor.BN(1_000_000))
        .accounts({
          user: this.userKeypair.publicKey,
          token: this.USDC_TOKEN_ADDRESS,
          tokenProgram: this.TOKEN_PROGRAM,
        })
        .signers([this.master])
        .rpc();
      console.log(transaction);
    } catch (error) {
      console.error(error);
    }
  }

  private async getUserAtaBalance(userAtaAddress: PublicKey): Promise<number> {
    const balanceInfo =
      await this.connection.getTokenAccountBalance(userAtaAddress);
    console.log('Balance:', balanceInfo.value.amount);
    const balance: number = parseInt(balanceInfo.value.amount);
    return balance;
  }

  private getUsageTimeLimit(
    startUsageTime: Date,
    userAtaBalance: number,
  ): Date {
    const minutesLimit = userAtaBalance / this.USDC_PRICE_PER_MINUTE;
    const minutesLimitToMilliseconds: number = minutesLimit * 60 * 1000;
    const usageTimeLimit: Date = new Date(
      startUsageTime.getTime() + minutesLimitToMilliseconds,
    );
    return usageTimeLimit;
  }

  private getPublicKeyFromWsClient(client: Socket): PublicKey {
    // Get handshake headers
    const authHeader = client.request.headers.authorization;
    // Get bearer token from headers
    const bearerToken = authHeader.split(' ')[1];
    // Get payload from encoded token
    const payload = this.jwtService.verify(bearerToken, {
      secret: process.env.JWT_SECRET,
    });
    return new PublicKey(payload.publicKey);
  }

  private async setLimitedUsageTimeout(client: Socket) {}
}
