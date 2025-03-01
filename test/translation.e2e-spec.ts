import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AccountService } from 'src/account/account.service';
import { Keypair } from '@solana/web3.js';
import { AuthService } from 'src/auth/auth.service';
import 'dotenv/config';
import { Socket } from 'socket.io-client';
import { getAccessToken } from './utils/auth.helper';
import { SubscriptionType } from 'src/payment/constants/subscription-type.enum';
import { DepositProgramService } from 'src/deposit-program/deposit-program.service';
import { MockDepositProgramService } from './utils/deposit-program.mock';
import { SubscriptionPrice } from 'src/payment/constants/subscription-price.enum';
import { PaymentService } from 'src/payment/payment.service';
import { sleep } from './utils/payment.helper';
import { getSocket as getClientSocket } from './utils/translation.helper';
import { BN } from '@coral-xyz/anchor';

const PORT = process.env.API_PORT || 11000;
const defaultFreeHours = 3 * 60 * 60;
const timeToTranslateMs = 7000;
const timeToDisconnect = 2000;
const testTimeout = 20000;
const mockAudioBuffer = new Uint8Array([0, 255, 128, 64, 32, 16, 8, 4, 2, 1]);

let app: INestApplication;
let accountService: AccountService;
let authService: AuthService;
let mockedDepositService: MockDepositProgramService;
let paymentService: PaymentService;

let user: Keypair;
let accessToken: string;
let clientSocket: Socket;

// Array to clean users after all tests
let accounts: string[] = [];

describe('Translation Module E2E', () => {
  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DepositProgramService)
      .useValue(new MockDepositProgramService())
      .compile();

    accountService = moduleFixture.get<AccountService>(AccountService);
    authService = moduleFixture.get<AuthService>(AuthService);
    mockedDepositService = moduleFixture.get<MockDepositProgramService>(
      DepositProgramService,
    );
    paymentService = moduleFixture.get<PaymentService>(PaymentService);

    user = Keypair.generate();
    accounts.push(user.publicKey.toString());
    accessToken = await getAccessToken(authService, user);

    app = moduleFixture.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
    await app.listen(PORT);
  });

  //--- TEST HANDSHAKE's HEADERS ---
  it('Should get unauthorized error', async () => {
    const startPaymentSpy = jest.spyOn(
      paymentService as any,
      'startPaymentWithRequiredMethod',
    );
    const stopPaymentSpy = jest.spyOn(
      paymentService as any,
      'stopPaymentWithRequiredMethod',
    );

    clientSocket = getClientSocket(
      SubscriptionType.PER_MINUTE,
      'invalid-token',
    );
    const socketError: any = await new Promise((resolve) => {
      clientSocket.on('error', (error) => {
        resolve(error);
      });
    });
    expect(socketError.message).toBe('Error while authenticating user');
    expect(startPaymentSpy).not.toHaveBeenCalled();
    expect(stopPaymentSpy).not.toHaveBeenCalled();
  });

  it('Should get invalid subscription error', async () => {
    const startPayingSpy = jest.spyOn(
      paymentService as any,
      'startPayingPerMinutes',
    );
    const stopPayingSpy = jest.spyOn(
      paymentService as any,
      'stopPayingPerMinutes',
    );
    clientSocket = getClientSocket('invalid-subscription', accessToken);
    const socketError: any = await new Promise((resolve) => {
      clientSocket.on('error', (error) => {
        resolve(error);
      });
    });
    expect(socketError.message).toBe(
      'Failed to start translation with the selected payment method',
    );
    expect(startPayingSpy).not.toHaveBeenCalled();
    expect(stopPayingSpy).not.toHaveBeenCalled();
  });

  // // --- TEST INTERACTION WITH PAYMENT ---
  it('Should get insufficient balance error (per minute)', async () => {
    clientSocket = getClientSocket(SubscriptionType.PER_MINUTE, accessToken);

    const socketError: any = await new Promise((resolve) => {
      clientSocket.on('error', (error) => {
        resolve(error);
      });
    });

    expect(socketError.error).toBe('Insufficient balance');
  });

  it(
    'Should get free trial error (no free hours left)',
    async () => {
      await accountService.setFreeHoursLeft(0, user.publicKey.toString());
      clientSocket = getClientSocket(SubscriptionType.FREE_TRIAL, accessToken);
      const socketError: any = await new Promise((resolve) => {
        clientSocket.on('error', (error) => {
          resolve(error);
        });
      });
      expect(socketError.message).toBeDefined();
    },
    testTimeout,
  );

  it(
    'Should successfully renew free hours and allow usage',
    async () => {
      const WEEK = 7 * 24 * 60 * 60 * 1000;
      const beforeWeek = new Date(new Date().getTime() - WEEK);
      // Set free hours start date to a week ago
      await accountService.setFreeHoursStartDate(
        beforeWeek,
        user.publicKey.toString(),
      );
      await accountService.setFreeHoursLeft(0, user.publicKey.toString());

      clientSocket = getClientSocket(SubscriptionType.FREE_TRIAL, accessToken);
      let socketError;
      clientSocket.on('error', (error) => {
        socketError = error;
      });
      // Simulate using translation with free trial subscription
      await sleep(timeToTranslateMs);

      const { freeHoursStartDate, freeHoursLeft } =
        await accountService.getFreeHoursInfo(user.publicKey.toString());

      expect(freeHoursLeft).toBe(defaultFreeHours);

      // Ensure Date within 5 second of the expected time
      const currentTimeMs = new Date().getTime();
      const expectedTime = currentTimeMs - timeToTranslateMs;
      expect(freeHoursStartDate.getTime()).toBeGreaterThanOrEqual(
        expectedTime - 5000,
      );
      expect(freeHoursStartDate.getTime()).toBeLessThanOrEqual(
        expectedTime + 5000,
      );

      expect(socketError).toBeUndefined();
    },
    testTimeout,
  );

  it(
    'Should start free trial and stop manually',
    async () => {
      const startPayingSpy = jest.spyOn(
        paymentService as any,
        'startFreeHoursUsing',
      );
      const stopPayingSpy = jest.spyOn(
        paymentService as any,
        'stopFreeHoursUsing',
      );

      clientSocket = getClientSocket(SubscriptionType.FREE_TRIAL, accessToken);
      let socketError;
      clientSocket.on('error', (error) => {
        socketError = error;
      });
      // Simulate using translation with free trial subscription
      await sleep(timeToTranslateMs);
      expect(startPayingSpy).toHaveBeenCalled();

      // User state during active translation
      const startHoursInfo = await accountService.getFreeHoursInfo(
        user.publicKey.toString(),
      );
      expect(startHoursInfo.freeHoursStartDate.getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
      expect(startHoursInfo.freeHoursLeft).toBe(defaultFreeHours);

      clientSocket.disconnect();
      await sleep(timeToDisconnect + 2000); // timeout to get disconnected
      expect(stopPayingSpy).toHaveBeenCalled();

      const { freeHoursStartDate, freeHoursLeft } =
        await accountService.getFreeHoursInfo(user.publicKey.toString());

      expect(freeHoursStartDate).toStrictEqual(
        startHoursInfo.freeHoursStartDate,
      );

      // Ensure Date within 1 second of the expected time
      const expectedTime = defaultFreeHours - timeToTranslateMs / 1000;
      expect(freeHoursLeft).toBeGreaterThanOrEqual(expectedTime - 5);
      expect(freeHoursLeft).toBeLessThanOrEqual(expectedTime + 5);

      expect(socketError).toBeUndefined();
    },
    testTimeout,
  );

  it(
    'Should get error because of executed timeout (free trial) ',
    async () => {
      await accountService.setFreeHoursLeft(1, user.publicKey.toString());
      clientSocket = getClientSocket(SubscriptionType.FREE_TRIAL, accessToken);
      let socketError;
      clientSocket.on('error', (error) => {
        socketError = error;
      });
      // Simulate using translation with free trial subscription
      await sleep(timeToTranslateMs);
      expect(socketError.message).toBe(
        'An error occurred while using free hours',
      );
      const newFreeHoursLeft = await accountService.getFreeHoursLeft(
        user.publicKey.toString(),
      );
      expect(newFreeHoursLeft).toBe(0);
    },
    testTimeout,
  );

  it(
    'Should start paying per minutes and stop manually',
    async () => {
      mockedDepositService.setUserBalance(
        SubscriptionPrice.PER_MINUTE * 1_000_000,
      );

      const startPayingSpy = jest.spyOn(
        paymentService as any,
        'startPayingPerMinutes',
      );
      const stopPayingSpy = jest.spyOn(
        paymentService as any,
        'stopPayingPerMinutes',
      );
      const payPerMinuteSpy = jest.spyOn(mockedDepositService, 'payPerMinute');

      clientSocket = getClientSocket(SubscriptionType.PER_MINUTE, accessToken);
      let socketError;
      clientSocket.on('error', (error) => {
        socketError = error;
      });
      // Simulate using translation with per minute subscription
      await sleep(timeToTranslateMs);
      expect(startPayingSpy).toHaveBeenCalled();
      expect(mockedDepositService.isBalanceFrozen).toBe(true); // User state during active translation

      clientSocket.disconnect();
      await sleep(timeToDisconnect); // timeout to get disconnected

      // Actions to be done after the translation is stopped
      expect(mockedDepositService.isBalanceFrozen).toBe(false);
      expect(stopPayingSpy).toHaveBeenCalled(); // payment stop method should be called
      expect(payPerMinuteSpy).toHaveBeenCalled(); // program money withdrawal method should be called
      expect(socketError).toBeUndefined();
    },
    testTimeout,
  );

  it(
    'Should get error because of executed timeout (per minute) ',
    async () => {
      const mockedBalance = SubscriptionPrice.PER_MINUTE * 1_000_000;
      mockedDepositService.setUserBalance(mockedBalance);
      const payPerMinuteSpy = jest.spyOn(mockedDepositService, 'payPerMinute');

      clientSocket = getClientSocket(SubscriptionType.PER_MINUTE, accessToken);

      // Simulate using translation with per minute subscription
      await sleep(62 * 1000); // 1 minute + 2 seconds to ensure get timeout

      expect(payPerMinuteSpy).toHaveBeenCalledWith(
        user.publicKey.toString(),
        new BN(mockedBalance), // program money withdrawal method should be called
      );
    },
    70 * 1000,
  );

  it(
    'Should start paying per hour and stop manually',
    async () => {
      mockedDepositService.setUserBalance(
        SubscriptionPrice.PER_HOUR * 1_000_000,
      );
      const startPayingSpy = jest.spyOn(
        paymentService as any,
        'startPayingPerHours',
      );
      const stopPayingSpy = jest.spyOn(
        paymentService as any,
        'stopPayingPerHours',
      );
      const payPerHourSpy = jest.spyOn(mockedDepositService, 'payPerHour');

      clientSocket = getClientSocket(SubscriptionType.PER_HOUR, accessToken);

      let socketError;
      clientSocket.on('error', (error) => {
        socketError = error;
      });
      // Simulate using translation with per minute subscription
      await sleep(timeToTranslateMs);

      // Actions to be done after the translation is started
      expect(startPayingSpy).toHaveBeenCalled();
      expect(mockedDepositService.isBalanceFrozen).toBe(true);

      clientSocket.disconnect();
      await sleep(timeToDisconnect); // timeout to get disconnected

      // Actions to be done after the translation is stopped
      expect(mockedDepositService.isBalanceFrozen).toBe(false);
      expect(stopPayingSpy).toHaveBeenCalled(); // payment stop method should be called
      expect(payPerHourSpy).toHaveBeenCalled(); // program money withdrawal method should be called

      expect(socketError).toBeUndefined();
    },
    testTimeout,
  );

  it(
    'Should get error because of executed timeout (per hour) ',
    async () => {
      mockedDepositService.setUserBalance(0);
      mockedDepositService.perHourLeft = 1;

      const payPerHourSpy = jest.spyOn(mockedDepositService, 'payPerHour');

      clientSocket = getClientSocket(SubscriptionType.PER_HOUR, accessToken);

      // Simulate using translation with per minute subscription
      await sleep(timeToTranslateMs);
      expect(payPerHourSpy).toHaveBeenCalled();
      expect(mockedDepositService.perHourLeft).toBe(0);
      expect(mockedDepositService.userBalance.toNumber()).toBe(0);
    },
    testTimeout,
  );

  //--- TEST AUDIO DATA ---
  // it(
  //   'Should receive audio from client',
  //   async () => {
  //     const handleAudioSpy = jest.spyOn(
  //       TranslationGateway.prototype,
  //       'handleAudioData',
  //     );
  //     clientSocket = getClientSocket(SubscriptionType.FREE_TRIAL, accessToken);
  //     let socketError;
  //     clientSocket.on('error', (error) => {
  //       socketError = error;
  //     });
  //     // clientSocket.on('message', (data) => {});

  //     clientSocket.emit(WsEvents.AUDIO_DATA, mockAudioBuffer);
  //     await sleep(3000);
  //     expect(socketError).toBeUndefined();
  //     expect(handleAudioSpy).toHaveBeenCalled();
  //   },
  //   testTimeout,
  // );

  afterEach(async () => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.close();
    }
    await app.close();
  });

  afterAll(async () => {
    await sleep(3000); // wait for all async operations to finish
    await accountService.deleteManyAccounts(accounts);
  }, testTimeout);
});
