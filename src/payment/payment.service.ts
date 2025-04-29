import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SubscriptionType } from './constants/subscription-type.enum';
import { AccountService } from 'src/account/account.service';
import { I18nService } from 'nestjs-i18n';
import { SubscriptionPrice } from './constants/subscription-price.enum';
import { RefundBalanceResponseDto } from './dto/refund-balance-response.dto';
import { DepositProgramService } from 'src/deposit-program/deposit-program.service';
import { WsEvents } from 'src/translation/constants/ws-events.enum';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  // Prices in raw format
  private readonly RAW_PRICE_PER_MINUTE =
    SubscriptionPrice.PER_MINUTE * 1_000_000;
  private readonly RAW_PRICE_PER_HOUR = SubscriptionPrice.PER_HOUR * 1_000_000;
  private readonly RAW_PRICE_SUBSCRIPTION =
    SubscriptionPrice.PER_MONTH * 1_000_000;

  // Free hours configuration values
  private readonly USER_DEFAULT_FREE_HOURS: number = 3 * 60 * 60; // hours * seconds * milliseconds
  private readonly TIME_TO_RENEW_FREE_HOURS_IN_MS: number =
    7 * 24 * 60 * 60 * 1000;

  // Per minute payment configuration values
  private readonly SECONDS_FROM_ROUND_TO_MIN = 40;

  constructor(
    private readonly programService: DepositProgramService,
    private readonly jwtService: JwtService,
    private readonly accountService: AccountService,
    private readonly i18n: I18nService,
    // schedulerRegistry<key: string(publicKey), value: Timeout>
    private readonly schedulerRegistry: SchedulerRegistry,
    // cacheManager<key: string(publicKey), value: Date(StartTime)>
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async refundUserBalance(
    userPublicKey: string,
    amount: number,
  ): Promise<RefundBalanceResponseDto> {
    try {
      // User's PDA address
      const userInfoAddress =
        this.programService.getUserInfoAddress(userPublicKey);

      const userInfo = await this.programService.getUserInfo(userInfoAddress);

      // Check if balance is frozen
      const isBalanceFrozen = userInfo.isBalanceFrozen;
      if (isBalanceFrozen) {
        throw new Error(this.i18n.t('payment.errors.balanceIsFrozen'));
      }

      // ATA address where user's balance is stored
      const userVaultAddress =
        await this.programService.getUserVaultAddress(userInfoAddress);

      const userVaultBalance =
        await this.programService.getUserVaultBalance(userVaultAddress);

      // Check if user has sufficient balance to refund
      if (userVaultBalance < amount) {
        throw new Error(this.i18n.t('payment.errors.insufficientBalance'));
      }

      // Refund user's balance
      const transaction = await this.programService.refundBalance(
        userPublicKey,
        amount,
      );
      this.logger.debug(
        `User [${userPublicKey}] balance [${userVaultBalance}] refunded`,
      );
      return { signature: transaction };
    } catch (error) {
      this.logger.error(`Error refunding user's balance: [${error}]`);

      // Throw exception to client
      throw new BadRequestException(
        this.i18n.t('payment.messages.BalanceRefundFailed') +
          ` ${error.message}`,
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
        case SubscriptionType.PER_MONTH:
          await this.startPerMonthUsing(client);
          break;
        default:
          throw new Error(
            this.i18nWs(client, 'payment.errors.invalidSubscriptionType'),
          );
      }
    } catch (error) {
      this.logger.error(
        `Error starting payment with required method: [${error.message}]`,
      );
      // Emit error to client and disconnect him
      const message = this.i18nWs(
        client,
        'payment.messages.startTranslationFailed',
      );
      this.emitErrorToClient(client, message, error);
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
        case SubscriptionType.PER_MONTH:
          break; // no logic for stopping subscription
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
      this.emitErrorToClient(client, message, error);
      client.disconnect();
    }
  }

  private async startPayingPerMinutes(client: Socket): Promise<void> {
    try {
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      this.logger.debug(`User [${userPublicKey}] started paying per usage`);

      const userBalance = await this.getVaultBalance(userPublicKey);

      // Throw error if user has insufficient balance
      this.checkForSufficientBalance(
        userBalance,
        this.RAW_PRICE_PER_MINUTE,
        client,
      );

      await this.programService.freezeBalance(userPublicKey);
      this.logger.debug(`User's [${userPublicKey}] balance is frozen`);

      // Define translation usage start time
      const usageStartTime = new Date();

      this.cacheManager.set(userPublicKey, usageStartTime);
      this.logger.debug(
        `Cache set for user [${userPublicKey}] with start time: [${usageStartTime}]`,
      );

      // Calculate the total minutes the user can use with his balance
      const minutesLimit = Math.floor(userBalance / this.RAW_PRICE_PER_MINUTE);

      // Determine the expiration time of the user's balance
      const usageTimeLimit = this.getTimeLimitPerMinutes(
        usageStartTime,
        minutesLimit,
      );

      // Check if user has an existing timeout and delete it
      if (this.schedulerRegistry.doesExist('timeout', userPublicKey)) {
        this.schedulerRegistry.deleteTimeout(userPublicKey);
        this.logger.debug(`Existing timeout [${userPublicKey}] removed`);
      }

      // Set a timeout to execute when the user's balance expires if paying per time was not manually stopped
      await this.setBalanceExpirationTimeout(
        client,
        userPublicKey,
        usageStartTime,
        usageTimeLimit,
        userBalance,
      );
      this.logger.debug(
        `Usage time limit set for user [${userPublicKey}]: [${usageTimeLimit}]`,
      );
      // Disconnect client if error occurs
    } catch (error) {
      this.logger.error(`Error starting pay per minutes: [${error}]`);

      // Emit error to client
      const message = this.i18nWs(
        client,
        'payment.messages.startPayPerUsageFailed',
      );
      this.emitErrorToClient(client, message, error);
      client.disconnect();

      // Release resources if error occurs
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      await this.clearUserResources(userPublicKey);
      await this.programService.unfreezeBalance(userPublicKey);
    }
  }

  private async stopPayingPerMinutes(client: Socket): Promise<void> {
    try {
      // Set the usage end time when the client stops paying per time
      const usageEndTime = new Date();

      // Get the usage start time from cache
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      const usageStartTime: Date = await this.cacheManager.get(userPublicKey);

      // Check if user has usage start time
      // For situations when timeouts are executed
      if (!usageStartTime) {
        this.logger.warn(
          `User [${userPublicKey}] has no usage start time. Ignoring stop request`,
        );
        await this.programService.unfreezeBalance(userPublicKey);
        return;
      }
      // Calculate the usage time in milliseconds
      const timeDifference = usageEndTime.getTime() - usageStartTime.getTime();

      // Convert the time difference to minutes
      const timeDifferenceInMin = timeDifference / (60 * 1000); // 60 sec * 1000 ms

      // Convert seconds into minutes for comparison
      const secondsInMin = this.SECONDS_FROM_ROUND_TO_MIN / 60;

      // Round up the total used minutes if seconds >= SECONDS_FROM_ROUND_TO_MINUTE
      const totalUsedMinutes =
        timeDifferenceInMin % 1 >= secondsInMin
          ? Math.ceil(timeDifferenceInMin)
          : Math.floor(timeDifferenceInMin);

      const totalPrice = totalUsedMinutes * this.RAW_PRICE_PER_MINUTE;
      this.logger.debug(
        `User's [${userPublicKey}] total price: [${totalPrice}]`,
      );

      // Reset user's state to initial state as before translation started
      await this.clearUserResources(userPublicKey);

      // Withdraw money from user using program
      await this.programService.payPerMinute(userPublicKey, totalPrice);
    } catch (error) {
      this.logger.error(`Error stopping pay per time: [${error}]`);
      // Disconnect client if error occurs
      const message = this.i18nWs(
        client,
        'payment.messages.stopPayPerUsageFailed',
      );
      this.emitErrorToClient(client, message, error);
      client.disconnect();

      // Release resources if error occurs
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      await this.clearUserResources(userPublicKey);
      await this.programService.unfreezeBalance(userPublicKey);
      this.logger.debug(`User's [${userPublicKey}] resources cleared`);
    }
  }

  private async startFreeHoursUsing(client: Socket): Promise<void> {
    try {
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      this.logger.debug(`Starting free hours using for [${userPublicKey}]`);

      // Get user's free hours start date
      let freeHoursStartDate =
        await this.accountService.getFreeHoursStartDate(userPublicKey);
      const currentUsageStartTime = new Date();

      // Set free hours start date if it's not set (for new users)
      if (!freeHoursStartDate) {
        await this.accountService.setFreeHoursStartDate(
          currentUsageStartTime,
          userPublicKey,
        );
        freeHoursStartDate = currentUsageStartTime;
        this.logger.debug(`User [${userPublicKey}] free hours start date set`);
      }

      // Check if renew is available
      let userFreeHoursLeft =
        await this.accountService.getFreeHoursLeft(userPublicKey);
      const differenceInMs =
        currentUsageStartTime.getTime() - freeHoursStartDate.getTime();

      const isRenewAvailable =
        differenceInMs >= this.TIME_TO_RENEW_FREE_HOURS_IN_MS;

      // Renew free hour if available
      if (isRenewAvailable) {
        await this.renewFreeHours(currentUsageStartTime, userPublicKey);
        userFreeHoursLeft = this.USER_DEFAULT_FREE_HOURS;
      }

      // If user has no free hours left and no renew, throw an error
      if (userFreeHoursLeft === 0) {
        this.logger.error(`User [${userPublicKey}] has no free hours left`);
        throw new Error(
          this.i18nWs(client, 'payment.errors.noFreeHoursAvailable'),
        );
      }

      // Check if user has an existing timeout and delete it
      if (this.schedulerRegistry.doesExist('timeout', userPublicKey)) {
        this.schedulerRegistry.deleteTimeout(userPublicKey);
        this.logger.debug(`Existing timeout [${userPublicKey}] removed`);
      }

      // Set expiration timeout for free hours if it's not stopped manually by the user
      this.setFreeHoursExpirationTimeout(
        userFreeHoursLeft,
        userPublicKey,
        client,
      );

      this.cacheManager.set(userPublicKey, currentUsageStartTime);
      this.logger.debug(
        `User [${userPublicKey}] set cache with start time: [${currentUsageStartTime}]`,
      );
      this.logger.debug(
        `User [${userPublicKey}] started using free hours at [${currentUsageStartTime}]`,
      );
    } catch (error) {
      this.logger.error(`Error starting free hours usage: [${error}]`);

      // Emit error to client and disconnect him
      const message = this.i18nWs(
        client,
        'payment.messages.startFreeHoursFailed',
      );
      this.emitErrorToClient(client, message, error);
      client.disconnect();

      // Remove user's cache if error occurs and it's set
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      await this.clearUserResources(userPublicKey);
    }
  }

  private async stopFreeHoursUsing(client: Socket): Promise<void> {
    try {
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      const usageEndTime = new Date();
      const usageStartTime: Date = await this.cacheManager.get(userPublicKey);

      // Check if user has usage start time
      // For situations when timeouts are executed
      if (!usageStartTime) {
        this.logger.warn(
          `User [${userPublicKey}] has no usage start time. Ignoring stop request`,
        );
        return;
      }

      // Calculate remaining free hours
      const timeDifferenceInMs =
        usageEndTime.getTime() - usageStartTime.getTime();

      // Get user's free hours left in seconds
      const userFreeHoursLeft =
        await this.accountService.getFreeHoursLeft(userPublicKey);

      // Convert time difference to seconds
      const totalUsedTime = Math.round(timeDifferenceInMs / 1000); // 1000 ms
      const remainingFreeHoursInSec = userFreeHoursLeft - totalUsedTime;

      // Set user's free hours to the remaining free hours
      await this.accountService.setFreeHoursLeft(
        remainingFreeHoursInSec,
        userPublicKey,
      );
      this.logger.debug(
        `User's [${userPublicKey}] free hours decreased from [${userFreeHoursLeft}] to [${remainingFreeHoursInSec}]`,
      );
      await this.clearUserResources(userPublicKey);
    } catch (error) {
      this.logger.error(`Error stopping free hours usage: [${error}]`);

      // Emit error to client and disconnect him
      const message = this.i18nWs(
        client,
        'payment.messages.stopFreeHoursFailed',
      );
      this.emitErrorToClient(client, message, error);
      client.disconnect();
    }
  }

  private async startPayingPerHours(client: Socket): Promise<void> {
    try {
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      this.logger.debug(`Starting pay per hours for [${userPublicKey}]`);
      const userInfoAddress =
        this.programService.getUserInfoAddress(userPublicKey);

      // ATA address where user's balance is stored
      const userVaultAddress =
        await this.programService.getUserVaultAddress(userInfoAddress);
      const userVaultBalance =
        await this.programService.getUserVaultBalance(userVaultAddress);

      // Get left hours in seconds
      const userInfo = await this.programService.getUserInfo(userInfoAddress);

      if (!userInfo) {
        this.logger.error(`User [${userPublicKey}] info not found`);
        throw new Error(this.i18nWs(client, 'payment.errors.userInfoNotFound'));
      }
      const perHoursLeft: number = userInfo.perHourLeft.toNumber();
      const hasRemainingHours = perHoursLeft > 0;

      // Check if user have not used free hours from last using
      // or sufficient balance to buy an hour
      if (!hasRemainingHours && userVaultBalance < this.RAW_PRICE_PER_HOUR) {
        this.logger.error(`User [${userPublicKey}] has insufficient balance`);
        throw new Error(
          this.i18nWs(client, 'payment.errors.insufficientBalance'),
        );
      }

      // Freeze user's balance
      await this.programService.freezeBalance(userPublicKey);
      this.logger.debug(`User's [${userPublicKey}] balance is frozen`);

      // Define translation usage start time
      const usageStartTime = new Date();

      // Store the usage start time in cache associated with the client's public key
      this.cacheManager.set(userPublicKey, usageStartTime);
      this.logger.debug(`Cache set for user [${userPublicKey}]`);

      // Determine the expiration time of the user's balance
      const availableTimeFromBalance = Math.floor(
        userVaultBalance / this.RAW_PRICE_PER_HOUR,
      );

      const availableTimeInMs = availableTimeFromBalance * 60 * 60 * 1000; // minutes * seconds * milliseconds

      let usageTimeLimit = new Date(Date.now() + availableTimeInMs);

      // Recalculate the time limit for the user's balance if free hours are available
      if (perHoursLeft > 0) {
        const perHoursLeftInMs = perHoursLeft * 1000; // 1000 milliseconds

        // Add hours left to the available time
        usageTimeLimit = new Date(
          Date.now() + availableTimeInMs + perHoursLeftInMs,
        );
      }

      // Check if user has an existing timeout and delete it
      if (this.schedulerRegistry.doesExist('timeout', userPublicKey)) {
        this.schedulerRegistry.deleteTimeout(userPublicKey);
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
        userVaultBalance,
        true, // For per hours payment
      );
      this.logger.debug(
        `Usage time limit set for user [${userPublicKey}]: [${usageTimeLimit}]`,
      );

      this.logger.debug(`User [${userPublicKey}] started paying per hours`);
    } catch (error) {
      this.logger.error(`Error starting pay per hour: [${error}]`);

      // Emit error to client and disconnect him
      const message = this.i18nWs(
        client,
        'payment.messages.startPayPerHoursFailed',
      );
      this.emitErrorToClient(client, message, error);
      client.disconnect();

      // Release resources if error occurs
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      await this.clearUserResources(userPublicKey);
      await this.programService.unfreezeBalance(userPublicKey);
      this.logger.debug(`User's [${userPublicKey}] resources cleared`);
    }
  }

  private async stopPayingPerHours(client: Socket): Promise<void> {
    try {
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      const usageStartTime: Date = await this.cacheManager.get(userPublicKey);
      // Check if user has usage start time
      // For situations when timeouts are executed
      if (!usageStartTime) {
        this.logger.warn(
          `User [${userPublicKey}] has no usage start time. Ignoring stop request`,
        );
        // Unfreeze user's balance if it's frozen
        await this.programService.unfreezeBalance(userPublicKey);
        return;
      }
      const usageEndTime = new Date();

      // Calculate the total used time in milliseconds
      const usageTimeInMs = usageEndTime.getTime() - usageStartTime.getTime();

      const userInfoAddress =
        this.programService.getUserInfoAddress(userPublicKey);
      const userInfo = await this.programService.getUserInfo(userInfoAddress);

      if (!userInfo) {
        this.logger.error(`User [${userPublicKey}] info not found`);
        throw new Error(this.i18nWs(client, 'payment.errors.userInfoNotFound'));
      }

      const perHoursLeft: number = userInfo.perHourLeft.toNumber();
      const perHoursLeftInHours = perHoursLeft / (60 * 60); // 60 seconds * 60 minutes

      const usageTimeInHours = usageTimeInMs / (60 * 60 * 1000); // 60 minutes * 60 seconds * 1000 milliseconds
      const totalUsageInHours = perHoursLeftInHours - usageTimeInHours;

      // If totalUsage is negative, user has used more remaining hours than he has left
      if (totalUsageInHours < 0) {
        // Calculate the total usage that should be paid
        // Get the absolute value of a number and then round it up
        const totalHoursToPay = Math.ceil(Math.abs(totalUsageInHours));

        // Set per hours left after the usage
        const newPerHoursLeft = totalHoursToPay - Math.abs(totalUsageInHours);

        const newPerHoursLeftInSec = Math.round(newPerHoursLeft * 60 * 60); // 60 minutes * 60 seconds

        // Calculate the total price for the used hours
        const rawTotalPrice = totalHoursToPay * this.RAW_PRICE_PER_HOUR;

        // Pay for the used hours
        await this.programService.payPerHour(
          userPublicKey,
          rawTotalPrice,
          newPerHoursLeftInSec,
        );
        this.logger.debug(
          `User's [${userPublicKey}] per hours left: ${newPerHoursLeftInSec} seconds`,
        );
        this.logger.debug(
          `User [${userPublicKey}] paid [${rawTotalPrice}] tokens for [${totalHoursToPay}] used hours`,
        );
      } else {
        // Set per hours left after the usage
        const totalUsageInSec = Math.round(totalUsageInHours * 60 * 60); // 60 minutes * 60 seconds
        await this.programService.payPerHour(
          userPublicKey,
          0, // No new hours to pay
          totalUsageInSec,
        );
        this.logger.debug(
          `User's [${userPublicKey}] per hours left: [${totalUsageInHours}]`,
        );
      }
      // Reset user's state to initial state as before translation started
      await this.clearUserResources(userPublicKey);
    } catch (error) {
      this.logger.error(`Error stopping pay per hour: [${error}]`);

      // Emit error to client and disconnect him
      const message = this.i18nWs(
        client,
        'payment.messages.stopPayPerHoursFailed',
      );
      this.emitErrorToClient(client, message, error);
      client.disconnect();

      // Release resources if error occurs
      const userPublicKey = this.getPublicKeyFromWsClient(client);
      await this.clearUserResources(userPublicKey);
      await this.programService.unfreezeBalance(userPublicKey);
      this.logger.debug(`User's [${userPublicKey}] resources cleared`);
    }
  }

  private async startPerMonthUsing(client: Socket): Promise<void> {
    const userPublicKey = this.getPublicKeyFromWsClient(client);
    this.logger.debug(
      `User [${userPublicKey}] started paying with subscription`,
    );
    const userInfoAddress =
      this.programService.getUserInfoAddress(userPublicKey);
    const userInfo = await this.programService.getUserInfo(userInfoAddress);

    const dateNowInSec = Math.floor(Date.now() / 1000); // 1000 ms

    // Buy subscription if necessary
    if (userInfo.subscriptionEndsAt <= dateNowInSec) {
      const userBalance = await this.getVaultBalance(userPublicKey);

      // Throws error if balance is insufficient
      this.checkForSufficientBalance(
        userBalance,
        this.RAW_PRICE_SUBSCRIPTION,
        client,
      );
      this.programService.buySubscription(userPublicKey);
      this.logger.debug(`User [${userPublicKey}] bought subscription`);
    }
  }

  private async getVaultBalance(userPublicKey: string): Promise<number> {
    const userInfoAddress =
      this.programService.getUserInfoAddress(userPublicKey);
    // ATA address where user balance is stored
    const userVaultAddress =
      await this.programService.getUserVaultAddress(userInfoAddress);

    const userVaultBalance =
      await this.programService.getUserVaultBalance(userVaultAddress);

    return userVaultBalance;
  }

  private checkForSufficientBalance(
    balance: number,
    price: number,
    client: Socket,
  ): void {
    if (balance < price) {
      this.logger.error(`User has insufficient balance`);
      throw new Error(
        this.i18nWs(client, 'payment.errors.insufficientBalance'),
      );
    }
  }

  private getTimeLimitPerMinutes(
    startUsageTime: Date,
    minutesLimit: number,
  ): Date {
    // Convert minutes limit to milliseconds
    const minutesLimitToMs = minutesLimit * 60 * 1000;

    // Calculate the time limit for the user's balance
    const usageTimeLimit = new Date(
      startUsageTime.getTime() + minutesLimitToMs,
    );
    return usageTimeLimit;
  }

  private getPublicKeyFromWsClient(client: Socket): string {
    // Get handshake's headers
    const authHeader = client.request.headers.authorization;

    // Get bearer token from headers
    const bearerToken = authHeader.split(' ')[1];

    // Encode payload from token
    // TODO: add type for payload
    const payload = this.jwtService.decode(bearerToken);
    return payload.publicKey;
  }

  private async setBalanceExpirationTimeout(
    client: Socket,
    userPublicKey: string,
    usageStartTime: Date,
    usageTimeLimit: Date,
    rawTotalPrice: number,
    hasRemainingHours: boolean = false, // Only for per hours payment
  ): Promise<void> {
    const msToExecute = usageTimeLimit.getTime() - usageStartTime.getTime();

    const taskName = userPublicKey;
    // Define timeout callback to execute when time limit is reached
    const timeoutCallback = async () => {
      // Pay for the used time
      // Depending on the selected payment method
      if (hasRemainingHours) {
        await this.programService.payPerHour(
          userPublicKey,
          rawTotalPrice,
          0, // Reset hours left
        );
      } else {
        await this.programService.payPerMinute(userPublicKey, rawTotalPrice);
      }
      this.logger.debug(
        `User [${userPublicKey}] paid for the used time: [${rawTotalPrice}] tokens`,
      );

      // Clear user's resources
      this.cacheManager.del(userPublicKey);
      this.logger.debug(`User's [${userPublicKey}] cache deleted`);

      // Emit error to client and disconnect him
      const message = this.i18nWs(
        client,
        `payment.messages.stopPayPer${hasRemainingHours ? 'Hours' : 'Usage'}Failed`,
      );
      const error = this.i18nWs(client, 'payment.errors.fundsRanOut');
      this.emitErrorToClient(client, message, error);
      client.disconnect();

      this.logger.debug(
        `User's [${userPublicKey}] balance expired. Timeout executed`,
      );
    };

    // Add timeout to scheduler registry
    const timeout = setTimeout(timeoutCallback, msToExecute);
    this.schedulerRegistry.addTimeout(taskName, timeout);
    this.logger.debug(
      `Timeout added to scheduler for user: [${userPublicKey}] executes in [${msToExecute}ms]`,
    );
  }

  private async setFreeHoursExpirationTimeout(
    userFreeHoursLeft: number,
    userPublicKey: string,
    client: Socket,
  ): Promise<void> {
    const timeoutCallback = async () => {
      // Reset user's free hours to 0
      await this.accountService.setFreeHoursLeft(0, userPublicKey);
      this.cacheManager.del(userPublicKey);

      this.logger.debug(`User's [${userPublicKey}] cache deleted`);
      this.logger.debug(
        `User's [${userPublicKey}] free hours expired. Timeout executed`,
      );

      // Emit error to client and disconnect him
      const message = this.i18nWs(
        client,
        'payment.messages.errorDuringFreeHours',
      );
      const error = this.i18nWs(client, 'payment.errors.freeHoursExpired');
      this.emitErrorToClient(client, message, error);
      client.disconnect();
    };

    // Add timeout to scheduler registry
    const msToExecute = userFreeHoursLeft * 1000; // 60 seconds * 1000 milliseconds
    const timeout = setTimeout(timeoutCallback, msToExecute);
    const taskName = userPublicKey;
    this.schedulerRegistry.addTimeout(taskName, timeout);
    this.logger.debug(
      `Timeout added to scheduler for user: [${userPublicKey}] executes in [${msToExecute}ms]`,
    );
  }

  // Reset user's state to initial state as before translation started
  private async clearUserResources(userPublicKey: string): Promise<void> {
    // Clear cache if exists
    if (await this.cacheManager.get(userPublicKey)) {
      await this.cacheManager.del(userPublicKey);
      this.logger.debug(`Cache deleted for user [${userPublicKey}]`);
    } else {
      this.logger.warn('No cache found for user');
    }
    // Clear timeout if exists
    if (this.schedulerRegistry.doesExist('timeout', userPublicKey)) {
      this.schedulerRegistry.deleteTimeout(userPublicKey);
      this.logger.debug(`Existing timeout [${userPublicKey}] removed`);
    } else {
      this.logger.warn('No timeout found for user');
    }
  }

  // Return true if free hours are renewed successfully or false otherwise
  private async renewFreeHours(
    usageStartTime: Date,
    userPublicKey: string,
  ): Promise<void> {
    // Renew free hours and set the start date to the current time
    await this.accountService.setFreeHoursLeft(
      this.USER_DEFAULT_FREE_HOURS,
      userPublicKey,
    );
    await this.accountService.setFreeHoursStartDate(
      usageStartTime,
      userPublicKey,
    );
    this.logger.debug(`User [${userPublicKey}] free hours renewed`);
  }

  // TODO: rewrite
  private emitErrorToClient(
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
    client.emit(WsEvents.ERROR, errorToEmit.getResponse());
  }

  private i18nWs(client: Socket, textToTranslate: string): string {
    // Get client's language from handshake's headers
    const lang = client.handshake.headers['accept-language'] || 'en';
    return this.i18n.translate(textToTranslate, { lang });
  }
}
