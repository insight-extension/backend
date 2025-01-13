import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import * as anchor from '@coral-xyz/anchor';
import {
  AnchorProvider,
  Program,
  setProvider,
  Wallet,
} from '@coral-xyz/anchor';
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
import { DepositProgram } from './interfaces/deposit_program';
import { I18nService } from 'nestjs-i18n';

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
  // Prices in raw format
  private readonly USDC_PRICE_PER_MINUTE = 0.03 * 1_000_000; // 0.03 USDC in raw format
  private readonly USDC_PRICE_PER_HOUR = 1.2 * 1_000_000; // 1.20 USDC in raw format
  private readonly USDC_SUBSCRIPTION_PRICE = 20 * 1_000_000; // 20 USDC in raw format

  constructor(
    private readonly jwtService: JwtService,
    private readonly accountService: AccountService,
    private readonly i18n: I18nService,
    // schedulerRegistry<key: string(publicKey), value: Timeout>
    private readonly schedulerRegistry: SchedulerRegistry,
    // TODO: resolve cache singleton problems
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
    // TODO: remove
    //this.depositToTimedVault(1_000_000);
    // this.depositToSubscriptionVault(5);
  }

  onModuleInit() {
    Logger.log('Payment Service initialized');
  }

  async refundUserTimedBalance(publicKey: string): Promise<string> {
    try {
      // Check if balance frozen
      const isBalanceFrozen: boolean =
        await this.accountService.getBalanceFreezingStatus(publicKey);

      if (isBalanceFrozen) {
        throw new Error(this.i18n.t('payment.errors.balanceIsFrozen'));
      }

      // User's PDA address
      const userPublicKey = new PublicKey(publicKey);

      const userTimedInfoAddress = this.getUserInfoAddress(
        InfoAccountType.TIMED,
        userPublicKey,
      );

      // ATA address where user's balance is stored
      const userTimedVaultAddress: PublicKey = await getAssociatedTokenAddress(
        this.USDC_TOKEN_ADDRESS,
        userTimedInfoAddress,
        true,
        this.TOKEN_PROGRAM,
      );

      const userTimedVaultBalance: number = await this.getUserVaultBalance(
        userTimedVaultAddress,
      );

      // Check if user has balance to refund
      if (userTimedVaultBalance === 0) {
        throw new Error(this.i18n.t('payment.errors.noBalanceToRefund'));
      }

      // Refund user's balance
      const transaction =
        await this.refundTimedBalanceThroughProgram(userPublicKey);
      Logger.log(
        `User [${userPublicKey.toString()}] balance [${userTimedVaultBalance}] refunded`,
      );
      return transaction;
    } catch (error) {
      Logger.error(`Error refunding user's balance: [${error}]`);

      // Throw exception to client
      throw new HttpException(
        {
          message: this.i18n.t('payment.messages.timedBalanceRefundFailed'),
          error: error.message,
          statusCode: HttpStatus.FORBIDDEN,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async refundUserSubscriptionBalance(publicKey: string): Promise<void> {
    try {
      // User's PDA address
      const userPublicKey = new PublicKey(publicKey);
      const [userInfoAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_subscription_info'), userPublicKey.toBuffer()],
        this.program.programId,
      );

      // ATA address where user's balance is stored
      const userVaultAddress: PublicKey = await getAssociatedTokenAddress(
        this.USDC_TOKEN_ADDRESS,
        userInfoAddress,
        true,
        this.TOKEN_PROGRAM,
      );

      const userVaultBalance: number =
        await this.getUserVaultBalance(userVaultAddress);

      // Check if user balance is positive
      if (userVaultBalance === 0) {
        throw new Error(this.i18n.t('payment.errors.noBalanceToRefund'));
      }

      // Refund user's subscription balance
      await this.refundSubscriptionBalanceThroughProgram(userPublicKey);
      Logger.log(
        `User [${userPublicKey.toString()}] subscription balance [${userVaultBalance}] refunded`,
      );
    } catch (error) {
      Logger.error(`Error refunding user's subscription balance: ${error}`);

      // Throw exception to client
      throw new HttpException(
        {
          message: this.i18n.t(
            'payment.messages.subscriptionBalanceRefundFailed',
          ),
          error: error.message,
          statusCode: HttpStatus.FORBIDDEN,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async startPaymentWithRequiredMethod(client: Socket): Promise<void> {
    try {
      // Get required payment method from client handshake's header
      const subscriptionType = client.request.headers.subscription;

      // Start payment method based on subscription type
      switch (subscriptionType) {
        case SubscriptionType.PER_USAGE:
          await this.startPayingPerMinutes(client);
          break;
        case SubscriptionType.PER_MONTH:
          await this.startPayingWithSubscription(client);
          break;
        case SubscriptionType.FREE_TRIAL:
          await this.startFreeHoursUsing(client);
          break;
        case SubscriptionType.PER_HOURS:
          await this.startPayingPerHours(client);
          break;
        default:
          throw new Error(
            this.i18nWs(client, 'payment.errors.invalidSubscriptionType'),
          );
      }
    } catch (error) {
      // Emit error to client and disconnect him
      const message: string = this.i18nWs(
        client,
        'payment.messages.startTranslationFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();
      Logger.error(`Error starting payment method: [${error}]`);
    }
  }

  async stopPaymentWithRequiredMethod(client: Socket): Promise<void> {
    try {
      // Get payment method from client handshake's header
      const subscriptionType = client.request.headers.subscription;

      // Stop payment method based on subscription type
      switch (subscriptionType) {
        case SubscriptionType.PER_USAGE:
          await this.stopPayingPerMinutes(client);
          break;
        case SubscriptionType.PER_MONTH:
          break;
        case SubscriptionType.FREE_TRIAL:
          await this.stopFreeHoursUsing(client);
          break;
        case SubscriptionType.PER_HOURS:
          await this.stopPayingPerHours(client);
          break;
        default:
          throw new Error(
            this.i18nWs(client, 'payment.errors.invalidSubscriptionType'),
          );
      }
    } catch (error) {
      // Emit error to client and disconnect him
      const message: string = this.i18nWs(
        client,
        'payment.messages.stopTranslationFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();
      Logger.error(
        `Error stopping translation with required payment method: [${error}]`,
      );
    }
  }

  private async startPayingPerMinutes(client: Socket): Promise<void> {
    console.log(this.i18nWs(client, 'payment.test'));
    try {
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      Logger.log(`User [${userPublicKey.toString()}] started paying per usage`);

      const [userTimedInfoAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_timed_info'), userPublicKey.toBuffer()],
        this.program.programId,
      );

      // ATA address where user's balance is stored
      const userTimedVaultAddress: PublicKey = await getAssociatedTokenAddress(
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
        throw new Error(
          this.i18nWs(client, 'payment.errors.insufficientBalance'),
        );
      }

      // Freeze user's balance
      await this.accountService.setBalanceFreezingStatus(
        true,
        userPublicKey.toString(),
      );
      Logger.log(`User's [${userPublicKey.toString()}] balance is frozen`);

      // Define translation usage start time
      const usageStartTime: Date = new Date();

      // Store the usage start time in cache associated with the client's public key
      this.cacheManager.set(userPublicKey.toString(), usageStartTime);
      Logger.log(
        `Cache set for user [${userPublicKey.toString()}] with start time: [${usageStartTime}]`,
      );

      // Determine the expiration time of the user's balance
      const usageTimeLimit: Date = this.getTimeLimitPerMinutes(
        usageStartTime,
        userTimedVaultBalance,
      );

      // Set a timeout to execute when the user's balance expires if paying per time was not manually stopped
      await this.setBalanceExpirationTimeout(
        client,
        userPublicKey,
        usageStartTime,
        usageTimeLimit,
        userTimedVaultBalance,
      );
      Logger.log(
        `Usage time limit set for user [${userPublicKey.toString()}]: [${usageTimeLimit}]`,
      );
      // Disconnect client if error occurs
    } catch (error) {
      Logger.error(`Error starting pay per usage: [${error}]`);

      // Emit error to client
      const message: string = this.i18nWs(
        client,
        'payment.messages.startPayPerUsageFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();

      // Release resources if error occurs
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      await this.clearUserResources(userPublicKey);
      Logger.log(`User's [${userPublicKey.toString()}] resources cleared`);
    }
  }

  private async stopPayingPerMinutes(client: Socket): Promise<void> {
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

      // Convert seconds into minutes for comparison
      const SECONDS_TO_ROUND: number = 40;
      const secondsInMinutes = SECONDS_TO_ROUND / 60;

      // Round up the total used minutes if seconds >= 40
      const totalUsedMinutes: number =
        timeDifferenceInMinutes % 1 >= secondsInMinutes
          ? Math.ceil(timeDifferenceInMinutes)
          : Math.floor(timeDifferenceInMinutes);

      const totalPrice: number = totalUsedMinutes * this.USDC_PRICE_PER_MINUTE;
      Logger.log(
        `User's [${userPublicKey.toString()}] total price: [${totalPrice}]`,
      );

      // Reset user's state to initial state as before translation started
      await this.clearUserResources(userPublicKey);
      Logger.log(`User's [${userPublicKey.toString()}] state reset`);

      // Withdraw money from user using program
      if (totalPrice !== 0) {
        await this.payPerTimeThroughProgram(userPublicKey, totalPrice);
      }
    } catch (error) {
      // Disconnect client if error occurs
      const message: string = this.i18nWs(
        client,
        'payment.messages.stopPayPerUsageFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();
      Logger.error(`Error stopping pay per time: [${error}]`);
    }
  }

  private async startFreeHoursUsing(client: Socket): Promise<void> {
    try {
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);

      // Get user's free hours start date
      let freeHoursStartDate: Date | null =
        await this.accountService.getFreeHoursStartDate(
          userPublicKey.toString(),
        );
      const currentUsageStartTime: Date = new Date();

      // Set free hours start date if it's not set (for new users)
      if (freeHoursStartDate === null) {
        await this.accountService.setFreeHoursStartDate(
          currentUsageStartTime,
          userPublicKey.toString(),
        );
        freeHoursStartDate = currentUsageStartTime;
        Logger.log(
          `User [${userPublicKey.toString()}] free hours start date set`,
        );
      }

      // Check if user has free hours left or renew is available
      const userFreeHoursLeft: number = await this.accountService.getFreeHours(
        userPublicKey.toString(),
      );
      if (userFreeHoursLeft === 0) {
        const isFreeHoursAvailable: boolean =
          await this.renewFreeHoursIfAvailable(
            currentUsageStartTime,
            userPublicKey,
            freeHoursStartDate,
          );
        if (!isFreeHoursAvailable) {
          throw new Error(
            this.i18nWs(client, 'payment.errors.noFreeHoursAvailable'),
          );
        }
      }

      // Set expiration timeout for free hours if it's not stopped manually by the user
      this.setFreeHoursExpirationTimeout(
        userFreeHoursLeft,
        userPublicKey,
        client,
      );

      this.cacheManager.set(userPublicKey.toString(), currentUsageStartTime);
      Logger.log(
        `User [${userPublicKey.toString()}] set cache with start time: [${currentUsageStartTime}]`,
      );

      Logger.log(
        `User [${userPublicKey.toString()}] started using free hours at [${currentUsageStartTime}]`,
      );
    } catch (error) {
      Logger.error(`Error starting free hours usage: [${error}]`);

      // Emit error to client and disconnect him
      const message: string = this.i18nWs(
        client,
        'payment.messages.startFreeHoursFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();

      // Remove user's cache if error occurs and it's set
      try {
        const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
        this.cacheManager.del(userPublicKey.toString());
        this.schedulerRegistry.deleteTimeout(userPublicKey.toString());
      } catch (error) {
        Logger.error(`Error deleting cache and timeout: [${error}]`);
      }
    }
  }

  private async stopFreeHoursUsing(client: Socket): Promise<void> {
    try {
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      const usageEndTime: Date = new Date();
      const usageStartTime: Date = await this.cacheManager.get(
        userPublicKey.toString(),
      );

      // Calculate remaining free hours
      const timeDifferenceInMilliseconds: number =
        usageEndTime.getTime() - usageStartTime.getTime();

      const ONE_HOUR_IN_MILLISECONDS = 60 * 60 * 1000; // minutes * seconds * milliseconds

      const userFreeHoursLeft: number = await this.accountService.getFreeHours(
        userPublicKey.toString(),
      );

      const totalUsedTime: number =
        timeDifferenceInMilliseconds / ONE_HOUR_IN_MILLISECONDS;

      const remainingFreeHours: number = userFreeHoursLeft - totalUsedTime;

      // Set user's free hours to the remaining free hours
      await this.accountService.setFreeHours(
        remainingFreeHours,
        userPublicKey.toString(),
      );
      Logger.log(
        `User's [${userPublicKey.toString()}] free hours decreased from [${userFreeHoursLeft}] to [${remainingFreeHours}]`,
      );

      this.cacheManager.del(userPublicKey.toString());
      Logger.log(
        `Cache deleted for user [${userPublicKey.toString()}] after stopping free hours usage`,
      );

      this.schedulerRegistry.deleteTimeout(userPublicKey.toString());
      Logger.log(
        `Timeout deleted for user [${userPublicKey.toString()}] after stopping free hours usage`,
      );
    } catch (error) {
      Logger.error(`Error stopping free hours usage: [${error}]`);

      // Emit error to client and disconnect him
      const message: string = this.i18nWs(
        client,
        'payment.messages.stopFreeHoursFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();
    }
  }

  private async startPayingPerHours(client: Socket): Promise<void> {
    try {
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      const [userTimedInfoAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_timed_info'), userPublicKey.toBuffer()],
        this.program.programId,
      );

      // ATA address where user's balance is stored
      const userTimedVaultAddress: PublicKey = await getAssociatedTokenAddress(
        this.USDC_TOKEN_ADDRESS,
        userTimedInfoAddress,
        true,
        this.TOKEN_PROGRAM,
      );
      const userTimedVaultBalance: number = await this.getUserVaultBalance(
        userTimedVaultAddress,
      );

      // Get user's hours left in decimal hours
      const perHoursLeft: number = await this.accountService.getPerHoursLeft(
        userPublicKey.toString(),
      );
      const hasRemainingHours: boolean = perHoursLeft > 0;
      // Check if user have not used free hours from last using or sufficient balance to buy an hour
      if (
        perHoursLeft === 0 &&
        userTimedVaultBalance < this.USDC_PRICE_PER_HOUR
      ) {
        throw new Error(
          this.i18nWs(client, 'payment.errors.insufficientBalance'),
        );
      }

      // Freeze user's balance
      await this.accountService.setBalanceFreezingStatus(
        true,
        userPublicKey.toString(),
      );
      Logger.log(`User's [${userPublicKey.toString()}] balance is frozen`);

      // Define translation usage start time
      const usageStartTime: Date = new Date();

      // Store the usage start time in cache associated with the client's public key
      this.cacheManager.set(userPublicKey.toString(), usageStartTime);
      Logger.log(`Cache set for user [${userPublicKey.toString()}]`);

      // Determine the expiration time of the user's balance
      const availableTimeFromBalance: number = Math.floor(
        userTimedVaultBalance / this.USDC_PRICE_PER_HOUR,
      );

      const availableTimeInMilliseconds: number =
        availableTimeFromBalance * 60 * 60 * 1000; // 60 minutes * 60 seconds * 1000 milliseconds

      let usageTimeLimit: Date = new Date(
        Date.now() + availableTimeInMilliseconds,
      );

      // Recalculate the time limit for the user's balance if free hours are available
      if (perHoursLeft > 0) {
        const perHoursLeftInMilliseconds: number =
          perHoursLeft * 60 * 60 * 1000; // 60 minutes * 60 seconds * 1000 milliseconds

        // Add hours left to the available time
        usageTimeLimit = new Date(
          Date.now() + availableTimeInMilliseconds + perHoursLeftInMilliseconds,
        );
      }

      // Set a timeout to execute when the user's balance expires if paying per time was not manually stopped
      await this.setBalanceExpirationTimeout(
        client,
        userPublicKey,
        usageStartTime,
        usageTimeLimit,
        userTimedVaultBalance,
        hasRemainingHours,
      );
      Logger.log(
        `Usage time limit set for user [${userPublicKey.toString()}]: [${usageTimeLimit}]`,
      );

      Logger.log(`User [${userPublicKey.toString()}] started paying per hours`);
    } catch (error) {
      Logger.error(`Error starting pay per hour: [${error}]`);

      // Emit error to client and disconnect him
      const message: string = this.i18nWs(
        client,
        'payment.messages.startPayPerHoursFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();

      // Release resources if error occurs
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      await this.clearUserResources(userPublicKey);
      Logger.log(`User's [${userPublicKey.toString()}] resources cleared`);
    }
  }

  private async stopPayingPerHours(client: Socket): Promise<void> {
    try {
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      const usageEndTime: Date = new Date();
      const usageStartTime: Date = await this.cacheManager.get(
        userPublicKey.toString(),
      );

      // Calculate the total used time in milliseconds
      const usageTimeInMilliseconds: number =
        usageEndTime.getTime() - usageStartTime.getTime();

      const perHoursLeft: number = await this.accountService.getPerHoursLeft(
        userPublicKey.toString(),
      );

      const usageTimeInHours: number =
        usageTimeInMilliseconds / (60 * 60 * 1000); // 60 minutes * 60 seconds * 1000 milliseconds

      const totalUsageInHours = perHoursLeft - usageTimeInHours;

      // If totalUsage is negative, user has used more remaining hours than he has left
      if (totalUsageInHours < 0) {
        // Calculate the total usage that should be paid (without hours left)
        const totalHoursToPay: number = Math.ceil(Math.abs(totalUsageInHours));

        // Set per hours left after the usage
        const newPerHoursLeft: number =
          totalHoursToPay - Math.abs(totalUsageInHours);

        await this.accountService.setPerHoursLeft(
          newPerHoursLeft,
          userPublicKey.toString(),
        );

        Logger.log(
          `User's [${userPublicKey.toString()}] per hours left: ${newPerHoursLeft}`,
        );

        // Calculate the total price for the used hours
        const totalPriceInRawUSDC: number =
          totalHoursToPay * this.USDC_PRICE_PER_HOUR;

        // Pay for the used hours
        await this.payPerTimeThroughProgram(userPublicKey, totalPriceInRawUSDC);
        Logger.log(
          `User [${userPublicKey.toString()}] paid [${totalPriceInRawUSDC}] USDC for [${totalHoursToPay}] used hours`,
        );
      } else {
        // Set per hours left after the usage
        await this.accountService.setPerHoursLeft(
          totalUsageInHours,
          userPublicKey.toString(),
        );
        Logger.log(
          `User's [${userPublicKey.toString()}] per hours left: [${totalUsageInHours}]`,
        );
      }

      // Reset user's state to initial state as before translation started
      await this.clearUserResources(userPublicKey);
      Logger.log(`User's [${userPublicKey.toString()}] resources cleared`);
    } catch (error) {
      Logger.error(`Error stopping pay per hour: [${error}]`);

      // Emit error to client and disconnect him
      const message: string = this.i18nWs(
        client,
        'payment.messages.stopPayPerHoursFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();

      // Release resources if error occurs
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      await this.clearUserResources(userPublicKey);
    }
  }

  private async startPayingWithSubscription(client: Socket): Promise<void> {
    try {
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);

      const [userInfoAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_subscription_info'), userPublicKey.toBuffer()],
        this.program.programId,
      );

      // ATA address where user's balance is stored
      const userVaultAddress: PublicKey = await getAssociatedTokenAddress(
        this.USDC_TOKEN_ADDRESS,
        userInfoAddress,
        true,
        this.TOKEN_PROGRAM,
      );

      const userInfo =
        await this.program.account.userSubscriptionInfo.fetch(userInfoAddress);

      const userVaultBalance: number =
        await this.getUserVaultBalance(userVaultAddress);

      // Define timestamps for the current time and the expiration time
      const currentTimestamp: number = new Date().getTime() / 1000; // Convert to seconds
      const subscriptionExpirationTimestamp: number =
        userInfo.expiration.toNumber();

      const isSubscriptionExpired: boolean =
        currentTimestamp > subscriptionExpirationTimestamp;

      // Check if user's subscription is expired or not initialized
      if (isSubscriptionExpired || !subscriptionExpirationTimestamp) {
        // Check if user has sufficient balance to pay for the subscription
        if (userVaultBalance < this.USDC_SUBSCRIPTION_PRICE) {
          throw new Error(
            this.i18nWs(client, 'payment.errors.insufficientBalance'),
          );
        }

        await this.buySubscriptionThroughProgram(
          userPublicKey,
          this.USDC_SUBSCRIPTION_PRICE,
        );
      }
    } catch (error) {
      Logger.error(`Error starting subscription: [${error}]`);

      // Emit error to client and disconnect him
      const message: string = this.i18nWs(
        client,
        'payment.messages.startSubscriptionFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();
    }
  }

  private async payPerTimeThroughProgram(
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
      Logger.log(`Payment done: [${transaction}]`);
    } catch (error) {
      Logger.error(error);
    }
  }

  private async buySubscriptionThroughProgram(
    userPublicKey: PublicKey,
    priceInRawUSDC: number,
  ): Promise<void> {
    try {
      const transaction = await this.program.methods
        .subscribeWithVault(new anchor.BN(priceInRawUSDC))
        .accounts({
          user: userPublicKey,
          token: this.USDC_TOKEN_ADDRESS,
          tokenProgram: this.TOKEN_PROGRAM,
        })
        .signers([this.master])
        .rpc();
      Logger.log(
        `Subscription bought by [${userPublicKey.toString()}], transaction: [${transaction}]`,
      );
    } catch (error) {
      Logger.error(error);
    }
  }

  private async refundTimedBalanceThroughProgram(
    userPublicKey: PublicKey,
  ): Promise<string> {
    try {
      const transaction: string = await this.program.methods
        .refundTimedBalance()
        .accounts({
          user: userPublicKey,
          token: this.USDC_TOKEN_ADDRESS,
          tokenProgram: this.TOKEN_PROGRAM,
        })
        .signers([this.master])
        .rpc();
      Logger.log(
        `Refund done for user [${userPublicKey.toString()}], transaction: [${transaction}]`,
      );
      return transaction;
    } catch (error) {
      Logger.error(error);
    }
  }

  private async refundSubscriptionBalanceThroughProgram(
    userPublicKey: PublicKey,
  ) {
    try {
      const transaction = await this.program.methods
        .refundSubscriptionBalance()
        .accounts({
          user: userPublicKey,
          token: this.USDC_TOKEN_ADDRESS,
          tokenProgram: this.TOKEN_PROGRAM,
        })
        .signers([this.master])
        .rpc();
      Logger.log(
        `Refund done for user [${userPublicKey.toString()}], transaction: [${transaction}]`,
      );
    } catch (error) {
      Logger.error(error);
    }
  }

  private async getUserVaultBalance(
    userTimedVaultAddress: PublicKey,
  ): Promise<number> {
    const balanceInfo = await this.connection.getTokenAccountBalance(
      userTimedVaultAddress,
    );
    const balance: number = parseInt(balanceInfo.value.amount);
    return balance;
  }

  private getTimeLimitPerMinutes(
    startUsageTime: Date,
    userTimedVaultBalance: number,
  ): Date {
    // Round down the user's balance to the nearest available minute
    const minutesLimit: number = Math.floor(
      userTimedVaultBalance / this.USDC_PRICE_PER_MINUTE,
    );

    // Convert minutes limit to milliseconds
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
    totalPriceInRawUSDC: number,
    hasRemainingHours: boolean = false, // Only for per hours payment
  ): Promise<void> {
    const millisecondsToExecute: number =
      usageTimeLimit.getTime() - usageStartTime.getTime();

    const taskName: string = userPublicKey.toString();

    // Define timeout callback to execute when time limit is reached
    const timeoutCallback = async () => {
      // Pay for the used time
      await this.payPerTimeThroughProgram(userPublicKey, totalPriceInRawUSDC);
      Logger.log(
        `User [${userPublicKey.toString()}] paid for the used time: [${totalPriceInRawUSDC}] USDC`,
      );

      // Reset hours left for paying per hours
      if (hasRemainingHours) {
        await this.accountService.setPerHoursLeft(0, userPublicKey.toString());
      }

      // Clear user's resources
      this.cacheManager.del(userPublicKey.toString());
      this.accountService.setBalanceFreezingStatus(
        false,
        userPublicKey.toString(),
      );

      // Emit error to client and disconnect him
      const message: string = this.i18nWs(
        client,
        `payment.messages.startPayPer${hasRemainingHours ? 'Hours' : 'Usage'}`,
      );
      const error: string = this.i18nWs(client, 'payment.errors.fundsRanOut');
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();
      Logger.log(
        `User's [${userPublicKey.toString()}] balance expired. Timeout executed`,
      );
    };

    // Add timeout to scheduler registry
    const timeout = setTimeout(timeoutCallback, millisecondsToExecute);
    this.schedulerRegistry.addTimeout(taskName, timeout);
    Logger.log(
      `Timeout added to scheduler for user: [${userPublicKey.toString()}] executes in [${millisecondsToExecute}ms]`,
    );
  }

  private async setFreeHoursExpirationTimeout(
    userFreeHoursLeft: number,
    userPublicKey: PublicKey,
    client: Socket,
  ): Promise<void> {
    const timeoutCallback = async () => {
      // Reset user's free hours to 0
      await this.accountService.setFreeHours(0, userPublicKey.toString());

      this.cacheManager.del(userPublicKey.toString());
      Logger.log(
        `User's [${userPublicKey.toString()}] free hours expired. Timeout executed`,
      );

      // Emit error to client and disconnect him
      const message: string = this.i18nWs(
        client,
        'payment.messages.errorDuringFreeHours',
      );
      const error: string = this.i18nWs(
        client,
        'payment.errors.freeHoursExpired',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();
    };

    // Add timeout to scheduler registry
    const millisecondsToExecute: number = userFreeHoursLeft * 60 * 1000;
    const timeout = setTimeout(timeoutCallback, millisecondsToExecute);
    const taskName: string = userPublicKey.toString();

    this.schedulerRegistry.addTimeout(taskName, timeout);
    Logger.log(
      `Timeout added to scheduler for user: [${userPublicKey.toString()}] executes in [${millisecondsToExecute}ms]`,
    );
  }

  // Reset user's state to initial state as before translation started
  private async clearUserResources(userPublicKey: PublicKey): Promise<void> {
    // Remove user's cache
    try {
      this.cacheManager.del(userPublicKey.toString());
    } catch (error) {
      Logger.error(`Error deleting cache: [${error}]`);
    }

    // Remove user's timeout
    try {
      this.schedulerRegistry.deleteTimeout(userPublicKey.toString());
    } catch (error) {
      Logger.error(`Error deleting timeout: [${error}]`);
    }

    // Unfreeze user's balance
    try {
      this.accountService.setBalanceFreezingStatus(
        false,
        userPublicKey.toString(),
      );
    } catch (error) {
      Logger.error(`Error setting balance freezing status: [${error}]`);
    }
  }

  // Return true if free hours are renewed successfully or false otherwise
  private async renewFreeHoursIfAvailable(
    usageStartTime: Date,
    userPublicKey: PublicKey,
    freeHoursStartDate: Date | null,
  ): Promise<boolean> {
    // Get elapsed time since the user's free hours was received last time
    const differenceInMilliseconds: number =
      usageStartTime.getTime() - freeHoursStartDate.getTime();

    const ONE_WEEK_IN_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

    // Renew free hours and set the start date to the current time if difference is greater than or equal to a week
    if (differenceInMilliseconds >= ONE_WEEK_IN_MILLISECONDS) {
      const USER_DEFAULT_FREE_HOURS: number = 3;

      await this.accountService.setFreeHours(
        USER_DEFAULT_FREE_HOURS,
        userPublicKey.toString(),
      );

      await this.accountService.setFreeHoursStartDate(
        usageStartTime,
        userPublicKey.toString(),
      );
      Logger.log(`User [${userPublicKey.toString()}] free hours renewed`);
      return true;
    }
    // Free hours not renewed
    Logger.warn(`User [${userPublicKey.toString()}] free hours not renewed`);
    return false;
  }

  private getUserInfoAddress(
    infoAccountType: string,
    userPublicKey: PublicKey,
  ) {
    const [userTimedInfoAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from(infoAccountType), userPublicKey.toBuffer()],
      this.program.programId,
    );
    return userTimedInfoAddress;
  }

  private emitErrorToWsClient(
    client: Socket,
    message: string,
    error: any,
    statusCode: number = HttpStatus.FORBIDDEN,
  ): void {
    const errorToEmit = new HttpException(
      {
        message,
        error: error.message,
        statusCode,
      },
      statusCode,
    );
    client.emit('error', errorToEmit.getResponse());
  }

  private i18nWs(client: Socket, textToTranslate: string): string {
    // Get client's language from handshake's headers
    const lang = client.handshake.headers['accept-language'] || 'en';
    return this.i18n.translate(textToTranslate, { lang });
  }

  // TODO: Remove this test method
  private async depositToTimedVault(price: number): Promise<void> {
    try {
      const user = Keypair.fromSecretKey(
        new Uint8Array(bs58.decode(process.env.SECOND_PRIVATE_KEY ?? '')),
      );
      const transaction = await this.program.methods
        .depositToTimedVault(new anchor.BN(price))
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

  // TODO: Remove this test method
  private async depositToSubscriptionVault(price: number): Promise<void> {
    try {
      const user = Keypair.fromSecretKey(
        new Uint8Array(bs58.decode(process.env.SECOND_PRIVATE_KEY ?? '')),
      );
      const transaction = await this.program.methods
        .depositToSubscriptionVault(new anchor.BN(price))
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
