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
import { I18nService } from 'nestjs-i18n';
import { AccountType } from './constants/account-type.enum';
import { SubscriptionPrice } from './constants/subscription-price.enum';
import { DepositProgram } from './interfaces/deposit_program';
import { RefundBalanceResponseDto } from './dto/refund-balance-response.dto';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
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
  private readonly USDC_PRICE_PER_MINUTE =
    SubscriptionPrice.PER_USAGE * 1_000_000;
  private readonly USDC_PRICE_PER_HOUR = SubscriptionPrice.PER_HOUR * 1_000_000;

  // Default free hours for new users in seconds
  private readonly USER_DEFAULT_FREE_HOURS: number = 3 * 60 * 60; // hours * seconds * milliseconds

  constructor(
    private readonly jwtService: JwtService,
    private readonly accountService: AccountService,
    private readonly i18n: I18nService,
    // schedulerRegistry<key: string(publicKey), value: Timeout>
    private readonly schedulerRegistry: SchedulerRegistry,
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
  }

  async refundUserBalance(
    publicKey: string,
    amount: number,
  ): Promise<RefundBalanceResponseDto> {
    try {
      // User's PDA address
      const userPublicKey = new PublicKey(publicKey);
      const userInfoAddress = this.getUserInfoAddress(
        AccountType.INFO,
        userPublicKey,
      );

      const userInfo =
        await this.program.account.userInfo.fetch(userInfoAddress);

      // Check if balance is frozen
      const isBalanceFrozen = userInfo.isBalanceFrozen;
      if (isBalanceFrozen) {
        this.logger.error(
          `User [${userPublicKey.toString()}] balance is frozen`,
        );
        throw new Error(this.i18n.t('payment.errors.balanceIsFrozen'));
      }

      // ATA address where user's balance is stored
      const userTimedVaultAddress = await getAssociatedTokenAddress(
        this.USDC_TOKEN_ADDRESS,
        userInfoAddress,
        true,
        this.TOKEN_PROGRAM,
      );

      const userVaultBalance = await this.getUserVaultBalance(
        userTimedVaultAddress,
      );

      // Check if user has sufficient balance to refund
      if (userVaultBalance < amount) {
        this.logger.error(
          `User [${userPublicKey.toString()}] has insufficient balance`,
        );
        throw new Error(this.i18n.t('payment.errors.insufficientBalance'));
      }

      // Refund user's balance
      const transaction = await this.refundBalanceThroughProgram(
        userPublicKey,
        amount,
      );
      this.logger.debug(
        `User [${userPublicKey.toString()}] balance [${userVaultBalance}] refunded`,
      );
      return { signature: transaction };
    } catch (error) {
      this.logger.error(`Error refunding user's balance: [${error}]`);

      // TODO: rewrite normally
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

  async startPaymentWithRequiredMethod(client: Socket): Promise<void> {
    try {
      // Get required payment method from client handshake's header
      const subscriptionType = client.request.headers.subscription as string;

      // Start payment method based on subscription type
      switch (subscriptionType) {
        case SubscriptionType.PER_MINUTE:
          await this.startPayingPerMinutes(client);
          break;
        case SubscriptionType.FREE_TRIAL:
          await this.startFreeHoursUsing(client);
          break;
        case SubscriptionType.PER_HOUR:
          await this.startPayingPerHours(client);
          break;
        default:
          this.logger.error(`Invalid subscription type: [${subscriptionType}]`);
          throw new Error(
            this.i18nWs(client, 'payment.errors.invalidSubscriptionType'),
          );
      }
    } catch (error) {
      this.logger.error(
        `Error starting payment with required method: [${error}]`,
      );
      // Emit error to client and disconnect him
      const message = this.i18nWs(
        client,
        'payment.messages.startTranslationFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();
    }
  }

  async stopPaymentWithRequiredMethod(client: Socket): Promise<void> {
    try {
      // Get payment method from client handshake's header
      const subscriptionType = client.request.headers.subscription;

      // Stop payment method based on subscription type
      switch (subscriptionType) {
        case SubscriptionType.PER_MINUTE:
          await this.stopPayingPerMinutes(client);
          break;
        case SubscriptionType.FREE_TRIAL:
          await this.stopFreeHoursUsing(client);
          break;
        case SubscriptionType.PER_HOUR:
          await this.stopPayingPerHours(client);
          break;
        default:
          throw new Error(
            this.i18nWs(client, 'payment.errors.invalidSubscriptionType'),
          );
      }
    } catch (error) {
      this.logger.error(
        `Error stopping payment with required method: [${error.message}]`,
      );
      // Emit error to client and disconnect him
      const message = this.i18nWs(
        client,
        'payment.messages.stopTranslationFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();
    }
  }

  private async startPayingPerMinutes(client: Socket): Promise<void> {
    try {
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      this.logger.debug(
        `User [${userPublicKey.toString()}] started paying per usage`,
      );

      const userInfoAddress = this.getUserInfoAddress(
        AccountType.INFO,
        userPublicKey,
      );

      // ATA address where user balance is stored
      const userVaultAddress: PublicKey = await getAssociatedTokenAddress(
        this.USDC_TOKEN_ADDRESS,
        userInfoAddress,
        true,
        this.TOKEN_PROGRAM,
      );

      const userVaultBalance = await this.getUserVaultBalance(userVaultAddress);

      // Check if user has sufficient balance
      if (userVaultBalance < this.USDC_PRICE_PER_MINUTE) {
        this.logger.error(
          `User [${userPublicKey.toString()}] has insufficient balance`,
        );
        throw new Error(
          this.i18nWs(client, 'payment.errors.insufficientBalance'),
        );
      }

      // Freeze user balance
      await this.freezeBalanceThroughProgram(client, userPublicKey);
      this.logger.debug(
        `User's [${userPublicKey.toString()}] balance is frozen`,
      );

      // Define translation usage start time
      const usageStartTime = new Date();

      // Store the usage start time in cache associated with the client's public key
      this.cacheManager.set(userPublicKey.toString(), usageStartTime);
      this.logger.debug(
        `Cache set for user [${userPublicKey.toString()}] with start time: [${usageStartTime}]`,
      );

      // Calculate the total minutes the user can use with his balance
      const minutesLimit = Math.floor(
        userVaultBalance / this.USDC_PRICE_PER_MINUTE,
      );

      // Determine the expiration time of the user's balance
      const usageTimeLimit = this.getTimeLimitPerMinutes(
        usageStartTime,
        minutesLimit,
      );

      // Check if user has an existing timeout and delete it
      if (
        this.schedulerRegistry.doesExist('timeout', userPublicKey.toString())
      ) {
        this.schedulerRegistry.deleteTimeout(userPublicKey.toString());
        this.logger.debug(
          `Existing timeout [${userPublicKey.toString()}] removed`,
        );
      }

      // Set a timeout to execute when the user's balance expires if paying per time was not manually stopped
      await this.setBalanceExpirationTimeout(
        client,
        userPublicKey,
        usageStartTime,
        usageTimeLimit,
        userVaultBalance,
      );
      this.logger.debug(
        `Usage time limit set for user [${userPublicKey.toString()}]: [${usageTimeLimit}]`,
      );
      // Disconnect client if error occurs
    } catch (error) {
      this.logger.error(`Error starting pay per minutes: [${error}]`);

      // Emit error to client
      const message = this.i18nWs(
        client,
        'payment.messages.startPayPerUsageFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();

      // Release resources if error occurs
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      try {
        await this.clearUserResources(userPublicKey);
        await this.unfreezeBalanceThroughProgram(client, userPublicKey);
        this.logger.debug(
          `User's [${userPublicKey.toString()}] resources cleared`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to release resources: [${error}] for [${userPublicKey.toString()}]`,
        );
      }
    }
  }

  private async stopPayingPerMinutes(client: Socket): Promise<void> {
    try {
      // Set the usage end time when the client stops paying per time
      const usageEndTime = new Date();

      // Get the usage start time from cache
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      const usageStartTime: Date = await this.cacheManager.get(
        userPublicKey.toString(),
      );

      // Check if user has usage start time
      // For situations when timeouts are executed
      if (!usageStartTime) {
        this.logger.warn(
          `User [${userPublicKey.toString()}] has no usage start time. Ignoring stop request`,
        );
        return;
      }
      // Calculate the usage time in milliseconds
      const timeDifference = usageEndTime.getTime() - usageStartTime.getTime();

      // TODO: check for seconds implementation
      // Convert the time difference to minutes
      const timeDifferenceInMinutes = timeDifference / (60 * 1000); // 60 sec * 1000 ms

      // Convert seconds into minutes for comparison
      const SECONDS_TO_ROUND = 40;
      const secondsInMinutes = SECONDS_TO_ROUND / 60;

      // Round up the total used minutes if seconds >= 40
      const totalUsedMinutes =
        timeDifferenceInMinutes % 1 >= secondsInMinutes
          ? Math.ceil(timeDifferenceInMinutes)
          : Math.floor(timeDifferenceInMinutes);

      const totalPrice = totalUsedMinutes * this.USDC_PRICE_PER_MINUTE;
      this.logger.debug(
        `User's [${userPublicKey.toString()}] total price: [${totalPrice}]`,
      );

      // Reset user's state to initial state as before translation started
      await this.clearUserResources(userPublicKey);
      this.logger.debug(`User's [${userPublicKey.toString()}] state reset`);

      // Withdraw money from user using program
      if (totalPrice !== 0) {
        await this.payPerMinuteThroughProgram(userPublicKey, totalPrice);
        return;
      }

      // Unfreeze user's balance if no money was withdrawn
      await this.unfreezeBalanceThroughProgram(client, userPublicKey);
      this.logger.debug(
        `User's [${userPublicKey.toString()}] balance is unfrozen`,
      );
    } catch (error) {
      this.logger.error(`Error stopping pay per time: [${error}]`);
      // Disconnect client if error occurs
      const message = this.i18nWs(
        client,
        'payment.messages.stopPayPerUsageFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();
    }
  }

  private async startFreeHoursUsing(client: Socket): Promise<void> {
    try {
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      this.logger.debug(
        `Starting free hours using for [${userPublicKey.toString()}]`,
      );

      // Get user's free hours start date
      let freeHoursStartDate = await this.accountService.getFreeHoursStartDate(
        userPublicKey.toString(),
      );
      const currentUsageStartTime = new Date();

      // Set free hours start date if it's not set (for new users)
      if (!freeHoursStartDate) {
        await this.accountService.setFreeHoursStartDate(
          currentUsageStartTime,
          userPublicKey.toString(),
        );
        freeHoursStartDate = currentUsageStartTime;
        this.logger.debug(
          `User [${userPublicKey.toString()}] free hours start date set`,
        );
      }

      // Check if renew is available
      let userFreeHoursLeft = await this.accountService.getFreeHours(
        userPublicKey.toString(),
      );
      const differenceInMilliseconds =
        currentUsageStartTime.getTime() - freeHoursStartDate.getTime();

      // TODO: maybe move to class constants
      const ONE_WEEK_IN_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

      const isRenewAvailable =
        differenceInMilliseconds >= ONE_WEEK_IN_MILLISECONDS;

      // Renew free hour if available
      if (isRenewAvailable) {
        await this.renewFreeHours(currentUsageStartTime, userPublicKey);
        userFreeHoursLeft = this.USER_DEFAULT_FREE_HOURS;
      }

      // If user has no free hours left and no renew, throw an error
      if (userFreeHoursLeft === 0) {
        this.logger.error(
          `User [${userPublicKey.toString()}] has no free hours left`,
        );
        throw new Error(
          this.i18nWs(client, 'payment.errors.noFreeHoursAvailable'),
        );
      }

      // Check if user has an existing timeout and delete it
      if (
        this.schedulerRegistry.doesExist('timeout', userPublicKey.toString())
      ) {
        this.schedulerRegistry.deleteTimeout(userPublicKey.toString());
        this.logger.debug(
          `Existing timeout [${userPublicKey.toString()}] removed`,
        );
      }

      // Set expiration timeout for free hours if it's not stopped manually by the user
      this.setFreeHoursExpirationTimeout(
        userFreeHoursLeft,
        userPublicKey,
        client,
      );

      this.cacheManager.set(userPublicKey.toString(), currentUsageStartTime);
      this.logger.debug(
        `User [${userPublicKey.toString()}] set cache with start time: [${currentUsageStartTime}]`,
      );

      this.logger.debug(
        `User [${userPublicKey.toString()}] started using free hours at [${currentUsageStartTime}]`,
      );
    } catch (error) {
      this.logger.error(`Error starting free hours usage: [${error}]`);

      // Emit error to client and disconnect him
      const message = this.i18nWs(
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
        this.logger.error(`Error deleting cache and timeout: [${error}]`);
      }
    }
  }

  private async stopFreeHoursUsing(client: Socket): Promise<void> {
    try {
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      const usageEndTime = new Date();
      const usageStartTime: Date = await this.cacheManager.get(
        userPublicKey.toString(),
      );

      // Check if user has usage start time
      // For situations when timeouts are executed
      if (!usageStartTime) {
        this.logger.warn(
          `User [${userPublicKey.toString()}] has no usage start time. Ignoring stop request`,
        );
        return;
      }

      // Calculate remaining free hours
      const timeDifferenceInMilliseconds =
        usageEndTime.getTime() - usageStartTime.getTime();

      // Get user's free hours left in seconds
      const userFreeHoursLeft = await this.accountService.getFreeHours(
        userPublicKey.toString(),
      );

      // Convert time difference to seconds
      const totalUsedTime = Math.round(timeDifferenceInMilliseconds / 1000); // 1000 ms
      const remainingFreeHoursInSeconds = userFreeHoursLeft - totalUsedTime;

      // Set user's free hours to the remaining free hours
      await this.accountService.setFreeHours(
        remainingFreeHoursInSeconds,
        userPublicKey.toString(),
      );
      this.logger.debug(
        `User's [${userPublicKey.toString()}] free hours decreased from [${userFreeHoursLeft}] to [${remainingFreeHoursInSeconds}]`,
      );

      // TODO: check for release function
      this.cacheManager.del(userPublicKey.toString());
      this.logger.debug(
        `Cache deleted for user [${userPublicKey.toString()}] after stopping free hours usage`,
      );

      // TODO: all deletes should be strictly checked
      this.schedulerRegistry.deleteTimeout(userPublicKey.toString());
      this.logger.debug(
        `Timeout deleted for user [${userPublicKey.toString()}] after stopping free hours usage`,
      );
    } catch (error) {
      this.logger.error(`Error stopping free hours usage: [${error}]`);

      // Emit error to client and disconnect him
      const message = this.i18nWs(
        client,
        'payment.messages.stopFreeHoursFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();
    }
  }

  private async startPayingPerHours(client: Socket): Promise<void> {
    try {
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      this.logger.debug(
        `Starting pay per hours for [${userPublicKey.toString()}]`,
      );
      const userInfoAddress = this.getUserInfoAddress(
        AccountType.INFO,
        userPublicKey,
      );

      // ATA address where user's balance is stored
      const userTimedVaultAddress = await getAssociatedTokenAddress(
        this.USDC_TOKEN_ADDRESS,
        userInfoAddress,
        true,
        this.TOKEN_PROGRAM,
      );
      const userTimedVaultBalance = await this.getUserVaultBalance(
        userTimedVaultAddress,
      );

      // Get left hours in seconds
      const userInfo =
        await this.program.account.userInfo.fetch(userInfoAddress);

      if (!userInfo) {
        this.logger.error(`User [${userPublicKey.toString()}] info not found`);
        throw new Error(this.i18nWs(client, 'payment.errors.userInfoNotFound'));
      }
      const perHoursLeft: number = userInfo.perHourLeft.toNumber();

      const hasRemainingHours = perHoursLeft > 0;

      // Check if user have not used free hours from last using
      // or sufficient balance to buy an hour
      if (
        !hasRemainingHours &&
        userTimedVaultBalance < this.USDC_PRICE_PER_HOUR
      ) {
        this.logger.error(
          `User [${userPublicKey.toString()}] has insufficient balance`,
        );
        throw new Error(
          this.i18nWs(client, 'payment.errors.insufficientBalance'),
        );
      }

      // Freeze user's balance
      await this.freezeBalanceThroughProgram(client, userPublicKey);
      this.logger.debug(
        `User's [${userPublicKey.toString()}] balance is frozen`,
      );

      // Define translation usage start time
      const usageStartTime = new Date();

      // Store the usage start time in cache associated with the client's public key
      this.cacheManager.set(userPublicKey.toString(), usageStartTime);
      this.logger.debug(`Cache set for user [${userPublicKey.toString()}]`);

      // Determine the expiration time of the user's balance
      const availableTimeFromBalance: number = Math.floor(
        userTimedVaultBalance / this.USDC_PRICE_PER_HOUR,
      );

      const availableTimeInMilliseconds: number =
        availableTimeFromBalance * 60 * 60 * 1000; // minutes * seconds * milliseconds

      let usageTimeLimit = new Date(Date.now() + availableTimeInMilliseconds);

      // Recalculate the time limit for the user's balance if free hours are available
      if (perHoursLeft > 0) {
        const perHoursLeftInMilliseconds = perHoursLeft * 1000; // 1000 milliseconds

        // Add hours left to the available time
        usageTimeLimit = new Date(
          Date.now() + availableTimeInMilliseconds + perHoursLeftInMilliseconds,
        );
      }

      // Check if user has an existing timeout and delete it
      // TODO: add logging for timeout deletion
      if (
        this.schedulerRegistry.doesExist('timeout', userPublicKey.toString())
      ) {
        this.schedulerRegistry.deleteTimeout(userPublicKey.toString());
        this.logger.warn(
          `Timeout already exists and was removed while starting pay per hours`,
        );
      }

      // Set a timeout to execute when the user's balance expires if paying per time was not manually stopped
      await this.setBalanceExpirationTimeout(
        client,
        userPublicKey,
        usageStartTime,
        usageTimeLimit,
        userTimedVaultBalance,
        true, // For per hours payment
      );
      this.logger.debug(
        `Usage time limit set for user [${userPublicKey.toString()}]: [${usageTimeLimit}]`,
      );

      this.logger.debug(
        `User [${userPublicKey.toString()}] started paying per hours`,
      );
    } catch (error) {
      this.logger.error(`Error starting pay per hour: [${error}]`);

      // Emit error to client and disconnect him
      const message = this.i18nWs(
        client,
        'payment.messages.startPayPerHoursFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();

      // Release resources if error occurs
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      try {
        await this.clearUserResources(userPublicKey);
        await this.unfreezeBalanceThroughProgram(client, userPublicKey);
        this.logger.debug(
          `User's [${userPublicKey.toString()}] resources cleared`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to release resources: [${error}] for [${userPublicKey.toString()}]`,
        );
      }
    }
  }

  private async stopPayingPerHours(client: Socket): Promise<void> {
    try {
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      const usageStartTime: Date = await this.cacheManager.get(
        userPublicKey.toString(),
      );
      // Check if user has usage start time
      // For situations when timeouts are executed
      if (!usageStartTime) {
        this.logger.warn(
          `User [${userPublicKey.toString()}] has no usage start time. Ignoring stop request`,
        );
        return;
      }
      const usageEndTime = new Date();

      // Calculate the total used time in milliseconds
      const usageTimeInMilliseconds =
        usageEndTime.getTime() - usageStartTime.getTime();

      const userInfoAddress = this.getUserInfoAddress(
        AccountType.INFO,
        userPublicKey,
      );
      const userInfo =
        await this.program.account.userInfo.fetch(userInfoAddress);

      if (!userInfo) {
        this.logger.error(`User [${userPublicKey.toString()}] info not found`);
        throw new Error(this.i18nWs(client, 'payment.errors.userInfoNotFound'));
      }

      const perHoursLeft: number = userInfo.perHourLeft.toNumber();
      const perHoursLeftInHours = perHoursLeft / (60 * 60); // 60 seconds * 60 minutes

      const usageTimeInHours = usageTimeInMilliseconds / (60 * 60 * 1000); // 60 minutes * 60 seconds * 1000 milliseconds
      const totalUsageInHours = perHoursLeftInHours - usageTimeInHours;

      // If totalUsage is negative, user has used more remaining hours than he has left
      if (totalUsageInHours < 0) {
        // Calculate the total usage that should be paid
        // Get the absolute value of a number and then round it up
        const totalHoursToPay = Math.ceil(Math.abs(totalUsageInHours));

        // Set per hours left after the usage
        const newPerHoursLeft = totalHoursToPay - Math.abs(totalUsageInHours);

        const newPerHoursLeftInSeconds = Math.round(newPerHoursLeft * 60 * 60); // 60 minutes * 60 seconds

        // Calculate the total price for the used hours
        const totalPriceInRawUSDC = totalHoursToPay * this.USDC_PRICE_PER_HOUR;

        // Pay for the used hours
        await this.payPerHourThroughProgram(
          userPublicKey,
          totalPriceInRawUSDC,
          newPerHoursLeftInSeconds,
        );
        this.logger.debug(
          `User's [${userPublicKey.toString()}] per hours left: ${newPerHoursLeftInSeconds} seconds`,
        );
        this.logger.debug(
          `User [${userPublicKey.toString()}] paid [${totalPriceInRawUSDC}] USDC for [${totalHoursToPay}] used hours`,
        );
      } else {
        // Set per hours left after the usage
        const totalUsageInSeconds = Math.round(totalUsageInHours * 60 * 60); // 60 minutes * 60 seconds
        await this.payPerHourThroughProgram(
          userPublicKey,
          0, // No new hours to pay
          totalUsageInSeconds,
        );
        this.logger.debug(
          `User's [${userPublicKey.toString()}] per hours left: [${totalUsageInHours}]`,
        );
      }
      // Reset user's state to initial state as before translation started
      await this.clearUserResources(userPublicKey);
      this.logger.debug(
        `User's [${userPublicKey.toString()}] resources cleared`,
      );
    } catch (error) {
      this.logger.error(`Error stopping pay per hour: [${error}]`);

      // Emit error to client and disconnect him
      const message = this.i18nWs(
        client,
        'payment.messages.stopPayPerHoursFailed',
      );
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();

      // Release resources if error occurs
      const userPublicKey: PublicKey = this.getPublicKeyFromWsClient(client);
      try {
        await this.clearUserResources(userPublicKey);
        await this.unfreezeBalanceThroughProgram(client, userPublicKey);
        this.logger.debug(
          `User's [${userPublicKey.toString()}] resources cleared`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to release resources: [${error}] for [${userPublicKey.toString()}]`,
        );
      }
    }
  }

  private async payPerMinuteThroughProgram(
    userPublicKey: PublicKey,
    priceInRawUSDC: number,
  ): Promise<void> {
    try {
      const transaction = await this.program.methods
        .payPerMinuteAndUnfreezeBalance(new anchor.BN(priceInRawUSDC))
        .accounts({
          user: userPublicKey,
          token: this.USDC_TOKEN_ADDRESS,
          tokenProgram: this.TOKEN_PROGRAM,
        })
        .signers([this.master])
        .rpc();
      this.logger.debug(`Payment done: [${transaction}]`);
    } catch (error) {
      this.logger.error(`Error paying per minute: [${error}]`);
    }
  }

  private async payPerHourThroughProgram(
    userPublicKey: PublicKey,
    priceInRawUSDC: number,
    perHoursLeft: number,
  ): Promise<void> {
    try {
      const transaction = await this.program.methods
        .payPerHourAndUnfreezeBalance(
          new anchor.BN(priceInRawUSDC),
          new anchor.BN(perHoursLeft),
        )
        .accounts({
          user: userPublicKey,
          token: this.USDC_TOKEN_ADDRESS,
          tokenProgram: this.TOKEN_PROGRAM,
        })
        .signers([this.master])
        .rpc();
      this.logger.debug(`Payment done: [${transaction}]`);
    } catch (error) {
      this.logger.error(`Error paying per hour: [${error}]`);
    }
  }

  private async refundBalanceThroughProgram(
    userPublicKey: PublicKey,
    amountInRawUSDC: number,
  ): Promise<string> {
    try {
      const transaction = await this.program.methods
        .refund(amountInRawUSDC)
        .accounts({
          user: userPublicKey,
          token: this.USDC_TOKEN_ADDRESS,
          tokenProgram: this.TOKEN_PROGRAM,
        })
        .signers([this.master])
        .rpc();
      this.logger.debug(
        `Refund done for user [${userPublicKey.toString()}], transaction: [${transaction}]`,
      );
      return transaction;
    } catch (error) {
      this.logger.error(`Error refunding balance: [${error}]`);
    }
  }

  private async freezeBalanceThroughProgram(
    client: Socket,
    userPublicKey: PublicKey,
  ): Promise<string> {
    try {
      const transaction = await this.program.methods
        .freezeBalance()
        .accounts({
          user: userPublicKey,
        })
        .signers([this.master])
        .rpc();
      return transaction;
    } catch (error) {
      this.logger.error(
        `Error freezing user's [${userPublicKey.toString()}] balance: [${error}]`,
      );
      throw new Error(
        this.i18nWs(client, 'payment.errors.balanceFreezingFailed'),
      );
    }
  }

  private async unfreezeBalanceThroughProgram(
    client: Socket,
    userPublicKey: PublicKey,
  ): Promise<string> {
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
      this.logger.error(
        `Error unfreezing user's [${userPublicKey.toString()}] balance: [${error}]`,
      );
      throw new Error(
        this.i18nWs(client, 'payment.errors.balanceUnfreezingFailed'),
      );
    }
  }
  private async getUserVaultBalance(
    userTimedVaultAddress: PublicKey,
  ): Promise<number> {
    const balanceInfo = await this.connection.getTokenAccountBalance(
      userTimedVaultAddress,
    );
    const balance = parseInt(balanceInfo.value.amount);
    return balance;
  }

  private getTimeLimitPerMinutes(
    startUsageTime: Date,
    minutesLimit: number,
  ): Date {
    // Convert minutes limit to milliseconds
    const minutesLimitToMilliseconds = minutesLimit * 60 * 1000;

    // Calculate the time limit for the user's balance
    const usageTimeLimit = new Date(
      startUsageTime.getTime() + minutesLimitToMilliseconds,
    );
    return usageTimeLimit;
  }

  private getPublicKeyFromWsClient(client: Socket): PublicKey {
    // Get handshake's headers
    const authHeader = client.request.headers.authorization;

    // Get bearer token from headers
    const bearerToken = authHeader.split(' ')[1];

    // Encode payload from token
    const payload = this.jwtService.decode(bearerToken);
    return new PublicKey(payload.publicKey);
  }

  private async setBalanceExpirationTimeout(
    client: Socket,
    userPublicKey: PublicKey,
    usageStartTime: Date,
    usageTimeLimit: Date,
    priceInRawUSDC: number,
    hasRemainingHours: boolean = false, // Only for per hours payment
  ): Promise<void> {
    const millisecondsToExecute =
      usageTimeLimit.getTime() - usageStartTime.getTime();

    const taskName = userPublicKey.toString();

    // Define timeout callback to execute when time limit is reached
    const timeoutCallback = async () => {
      // Pay for the used time
      // Depending on the selected payment method
      if (hasRemainingHours) {
        await this.payPerHourThroughProgram(
          userPublicKey,
          priceInRawUSDC,
          0, // Reset hours left
        );
      } else {
        await this.payPerMinuteThroughProgram(userPublicKey, priceInRawUSDC);
      }
      this.logger.debug(
        `User [${userPublicKey.toString()}] paid for the used time: [${priceInRawUSDC}] USDC`,
      );

      // Clear user's resources
      this.cacheManager.del(userPublicKey.toString());
      this.logger.debug(`User's [${userPublicKey.toString()}] cache deleted`);

      // Emit error to client and disconnect him
      const message = this.i18nWs(
        client,
        `payment.messages.stopPayPer${hasRemainingHours ? 'Hours' : 'Usage'}Failed`,
      );
      const error = this.i18nWs(client, 'payment.errors.fundsRanOut');
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();

      this.logger.debug(
        `User's [${userPublicKey.toString()}] balance expired. Timeout executed`,
      );
    };

    // Add timeout to scheduler registry
    const timeout = setTimeout(timeoutCallback, millisecondsToExecute);
    this.schedulerRegistry.addTimeout(taskName, timeout);
    this.logger.debug(
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
      this.logger.debug(`User's [${userPublicKey.toString()}] cache deleted`);
      this.logger.debug(
        `User's [${userPublicKey.toString()}] free hours expired. Timeout executed`,
      );

      // Emit error to client and disconnect him
      const message = this.i18nWs(
        client,
        'payment.messages.errorDuringFreeHours',
      );
      const error = this.i18nWs(client, 'payment.errors.freeHoursExpired');
      this.emitErrorToWsClient(client, message, error);
      client.disconnect();
    };

    // Add timeout to scheduler registry
    const millisecondsToExecute = userFreeHoursLeft * 60 * 1000; // 60 seconds * 1000 milliseconds
    const timeout = setTimeout(timeoutCallback, millisecondsToExecute);
    const taskName = userPublicKey.toString();

    this.schedulerRegistry.addTimeout(taskName, timeout);
    this.logger.debug(
      `Timeout added to scheduler for user: [${userPublicKey.toString()}] executes in [${millisecondsToExecute}ms]`,
    );
  }

  // Reset user's state to initial state as before translation started
  private async clearUserResources(userPublicKey: PublicKey): Promise<void> {
    // Remove user's cache
    try {
      this.cacheManager.del(userPublicKey.toString());
    } catch (error) {
      this.logger.warn(`Error deleting cache: [${error}]`);
    }

    // Remove user's timeout
    try {
      this.schedulerRegistry.deleteTimeout(userPublicKey.toString());
    } catch (error) {
      this.logger.warn(`Error deleting timeout: [${error}]`);
    }
  }

  // Return true if free hours are renewed successfully or false otherwise
  private async renewFreeHours(
    usageStartTime: Date,
    userPublicKey: PublicKey,
  ): Promise<void> {
    // Renew free hours and set the start date to the current time
    await this.accountService.setFreeHours(
      this.USER_DEFAULT_FREE_HOURS,
      userPublicKey.toString(),
    );
    await this.accountService.setFreeHoursStartDate(
      usageStartTime,
      userPublicKey.toString(),
    );
    this.logger.debug(`User [${userPublicKey.toString()}] free hours renewed`);
  }

  private getUserInfoAddress(
    infoAccountType: string,
    userPublicKey: PublicKey,
  ): PublicKey {
    const [userInfoAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from(infoAccountType), userPublicKey.toBuffer()],
      this.program.programId,
    );
    return userInfoAddress;
  }

  // TODO: rewrite
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
}
