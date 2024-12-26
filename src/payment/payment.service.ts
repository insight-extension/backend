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
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { SchedulerRegistry } from '@nestjs/schedule';
import bs58 from 'bs58';
import { SubscriptionType } from './constants/subscription-type.enum';
import { AccountService } from 'src/account/account.service';

@Injectable()
export class PaymentService implements OnModuleInit {
  private readonly anchorProvider: AnchorProvider;
  private readonly connection: Connection;
  private readonly program: Program<DepositProgram>;
  private readonly anchorProviderWallet: Wallet;
  private readonly master: Keypair;
  private readonly TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
  private readonly USDC_TOKEN_ADDRESS = new PublicKey(
    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  );
  private readonly USDC_PRICE_PER_MINUTE = 0.03 * 1_000_000; // 0.03 USDC in raw format

  constructor(
    private readonly jwtService: JwtService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly accountService: AccountService,
    // cacheManager<key: string(publicKey), value: Date(StartTime)>
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    // Setup config
    this.master = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(process.env.MASTER_KEY ?? '')),
    );
    this.connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    this.anchorProviderWallet = new Wallet(this.master);
    this.anchorProvider = new AnchorProvider(
      this.connection,
      this.anchorProviderWallet,
      AnchorProvider.defaultOptions(),
    );
    setProvider(this.anchorProvider);
    this.program = new Program(idl as DepositProgram, this.anchorProvider);
    // this.depositToTimedVault();
  }

  onModuleInit() {
    Logger.log('Payment Service initialized');
  }

  private async startPayingPerUsage(client: Socket): Promise<void> {
    try {
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      Logger.log(`User ${userPublicKey.toString()} started paying per usage`);

      const [userTimedInfoAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_timed_info'), userPublicKey.toBuffer()],
        this.program.programId,
      );
      // PDA address where user's balance is stored
      const userTimedVaultAddress = await getAssociatedTokenAddress(
        this.USDC_TOKEN_ADDRESS,
        userTimedInfoAddress,
        true,
        this.TOKEN_PROGRAM,
      );
      const userTimedVaultBalance: number = await this.getUserVaultBalance(
        userTimedVaultAddress,
      );
      // Check if user has sufficient balance
      if (userTimedVaultBalance < this.USDC_PRICE_PER_MINUTE) {
        throw new Error('Insufficient balance');
      }
      // Freeze user's balance
      this.accountService.setBalanceFreezingStatus(
        true,
        userPublicKey.toString(),
      );
      Logger.log(`User's ${userPublicKey.toString()} balance is frozen`);

      // Define translation usage start time
      const usageStartTime: Date = new Date();

      // Store the usage start time in cache associated with the client's public key
      this.cacheManager.set(userPublicKey.toString(), usageStartTime);
      Logger.log(
        `Cache set for user ${userPublicKey.toString()} with start time: ${usageStartTime}`,
      );
      // Determine the expiration time of the user's balance
      const usageTimeLimit: Date = this.getUsageTimeLimit(
        usageStartTime,
        userTimedVaultBalance,
      );
      // Set a timeout to execute when the user's balance expires if paying per time was not manually stopped
      this.setBalanceExpirationTimeout(
        client,
        userPublicKey,
        usageStartTime,
        usageTimeLimit,
        userTimedVaultBalance,
      );
      Logger.log(
        `Usage time limit set for user ${userPublicKey.toString()}: ${usageTimeLimit}`,
      );
    } catch (error) {
      // Disconnect client if error occurs
      client._error(error);
      Logger.error(`Error starting pay per usage: ${error}`);

      // Reset user's state to initial state as before translation started
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      this.returnUserToInitialState(userPublicKey);
      Logger.log(`User's ${userPublicKey.toString()} state reset`);
    }
  }

  private async stopPayingPerUsage(client: Socket): Promise<void> {
    try {
      // Set the usage end time when the client stops paying per time
      const usageEndTime: Date = new Date();

      // Get the usage start time from cache
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);

      const usageStartTime: Date = await this.cacheManager.get(
        userPublicKey.toString(),
      );

      // Calculate the usage time in milliseconds
      const timeDifference: number =
        usageEndTime.getTime() - usageStartTime.getTime();

      // Convert the time difference to minutes
      const timeDifferenceInMinutes: number = timeDifference / (60 * 1000);

      const SECONDS_TO_ROUND: number = 40;

      // Convert seconds into decimal format for comparison
      const convertedSeconds = SECONDS_TO_ROUND / 60;

      // Round up the total used minutes if seconds >= 40
      const totalUsedMinutes: number =
        timeDifferenceInMinutes % 1 >= convertedSeconds
          ? Math.ceil(timeDifferenceInMinutes)
          : Math.floor(timeDifferenceInMinutes);

      const totalPrice: number = totalUsedMinutes * this.USDC_PRICE_PER_MINUTE;
      Logger.log(
        `User's ${userPublicKey.toString()} total price: ${totalPrice}`,
      );

      // Reset user's state to initial state as before translation started
      this.returnUserToInitialState(userPublicKey);
      Logger.log(`User's ${userPublicKey.toString()} state reset`);

      // Withdraw money from user using program
      if (totalPrice !== 0) {
        await this.payPerTime(userPublicKey, totalPrice);
      }
    } catch (error) {
      Logger.error(`Error stopping pay per time: ${error}`);
      client._error(error);
    }
  }

  private async payPerTime(
    userPublicKey: PublicKey,
    totalPriceInRawUSDC: number,
  ): Promise<void> {
    try {
      const transaction = await this.program.methods
        .payPerTime(new anchor.BN(totalPriceInRawUSDC))
        .accounts({
          user: userPublicKey,
          token: this.USDC_TOKEN_ADDRESS,
          tokenProgram: this.TOKEN_PROGRAM,
        })
        .signers([this.master])
        .rpc();
      Logger.log(`Payment done: ${transaction}`);
    } catch (error) {
      Logger.error(error);
    }
  }

  private async getUserVaultBalance(
    userVaultAddress: PublicKey,
  ): Promise<number> {
    const balanceInfo =
      await this.connection.getTokenAccountBalance(userVaultAddress);
    const balance: number = parseInt(balanceInfo.value.amount);
    return balance;
  }

  private getUsageTimeLimit(
    startUsageTime: Date,
    userTimedVaultBalance: number,
  ): Date {
    const minutesLimit: number =
      userTimedVaultBalance / this.USDC_PRICE_PER_MINUTE;
    const minutesLimitToMilliseconds: number = minutesLimit * 60 * 1000;

    // Calculate the time limit for the user's balance
    const usageTimeLimit: Date = new Date(
      startUsageTime.getTime() + minutesLimitToMilliseconds,
    );
    return usageTimeLimit;
  }

  private getPublicKeyFromWsClient(client: Socket): PublicKey {
    // Get handshake's headers
    const authHeader: string = client.request.headers.authorization;
    // Get bearer token from headers
    const bearerToken: string = authHeader.split(' ')[1];
    // Encode payload from token
    const payload = this.jwtService.decode(bearerToken);
    return new PublicKey(payload.publicKey);
  }

  private async setBalanceExpirationTimeout(
    client: Socket,
    userPublicKey: PublicKey,
    usageStartTime: Date,
    usageTimeLimit: Date,
    userAtaBalance: number,
  ): Promise<void> {
    const millisecondsToExecute: number =
      usageTimeLimit.getTime() - usageStartTime.getTime();
    const taskName: string = userPublicKey.toString();
    const totalPriceInRawUSDC: number = userAtaBalance;

    // Define timeout callback to execute when time limit is reached
    const timeoutCallback = async () => {
      await this.payPerTime(userPublicKey, totalPriceInRawUSDC);
      this.cacheManager.del(userPublicKey.toString());
      this.accountService.setBalanceFreezingStatus(
        false,
        userPublicKey.toString(),
      );
      // TODO: Sent a message to the client to notify them of insufficient balance
      client.disconnect();
    };
    const timeout = setTimeout(timeoutCallback, millisecondsToExecute);
    // Add timeout to scheduler registry
    this.schedulerRegistry.addTimeout(taskName, timeout);
    Logger.log(
      `Timeout added to scheduler for user: ${userPublicKey.toString()} executes in ${millisecondsToExecute}ms`,
    );
  }

  // Reset user's state to initial state as before translation started
  private async returnUserToInitialState(
    userPublicKey: PublicKey,
  ): Promise<void> {
    // Remove user's cache
    try {
      this.cacheManager.del(userPublicKey.toString());
    } catch (error) {
      Logger.error(`Error deleting cache: ${error}`);
    }
    // Remove user's timeout
    try {
      this.schedulerRegistry.deleteTimeout(userPublicKey.toString());
    } catch (error) {
      Logger.error(`Error deleting timeout: ${error}`);
    }
    // Set user's balance freezing status to false
    try {
      this.accountService.setBalanceFreezingStatus(
        false,
        userPublicKey.toString(),
      );
    } catch (error) {
      Logger.error(`Error setting balance freezing status: ${error}`);
    }
  }

  async startPaymentWithRequiredMethod(client: Socket): Promise<void> {
    // Get payment method from handshake's header
    try {
      // Required payment method from client
      const subscriptionType = client.request.headers.subscription;

      // Start payment method based on subscription type
      // TODO: Implement the logic for starting payment method
      switch (subscriptionType) {
        case SubscriptionType.PER_USAGE:
          await this.startPayingPerUsage(client);
          break;
        case SubscriptionType.PER_MONTH:
          break;
        case SubscriptionType.FREE_TRIAL:
          break;
        default:
          throw new Error('Invalid subscription type');
      }
    } catch (error) {
      client._error(error);
      Logger.error(`Error starting payment method: ${error}`);
    }
  }

  async stopPaymentWithRequiredMethod(client: Socket): Promise<void> {
    // Get payment method from handshake's header
    try {
      // Required payment method from client
      const subscriptionType = client.request.headers.subscription;

      // Stop payment method based on subscription type
      switch (subscriptionType) {
        case SubscriptionType.PER_USAGE:
          await this.stopPayingPerUsage(client);
          break;
        case SubscriptionType.PER_MONTH:
          break;
        case SubscriptionType.FREE_TRIAL:
          break;
        default:
          throw new Error('Invalid subscription type');
      }
    } catch (error) {
      client._error(error);
      Logger.error(`Error starting payment method: ${error}`);
    }
  }

  // TODO: Remove this test method
  private async depositToTimedVault() {
    try {
      const user = Keypair.fromSecretKey(
        new Uint8Array(bs58.decode(process.env.SECOND_PRIVATE_KEY ?? '')),
      );
      const transaction = await this.program.methods
        .depositToTimedVault(new anchor.BN(30_000))
        .accounts({
          user: user.publicKey,
          token: this.USDC_TOKEN_ADDRESS,
          tokenProgram: this.TOKEN_PROGRAM,
        })
        .signers([user])
        .rpc();
      console.log(transaction);
    } catch (error) {
      console.log(`Error: ${error}`);
    }
  }
}
