import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PaymentService } from '../src/payment/payment.service';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAccessToken } from './utils/auth.helper';
import { AuthService } from 'src/auth/auth.service';
import { AccountService } from 'src/account/account.service';
import { DepositProgramService } from 'src/deposit-program/deposit-program.service';
import { UserInfo } from 'src/deposit-program/types/get-user-info.type';
import { MockDepositProgramService } from './utils/deposit-program.mock';

describe('PaymentModule (e2e)', () => {
  let app: INestApplication;
  let paymentService: PaymentService;
  let user: Keypair;
  let accessToken: string;
  let authService: AuthService;
  let accountService: AccountService;
  const mockSignature = 'tx123';
  const userBalance = 100;

  let mockedDepositService: MockDepositProgramService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DepositProgramService)
      .useValue(new MockDepositProgramService())
      .compile();

    mockedDepositService = moduleFixture.get<MockDepositProgramService>(
      DepositProgramService,
    );

    paymentService = moduleFixture.get<PaymentService>(PaymentService);
    authService = moduleFixture.get<AuthService>(AuthService);
    accountService = moduleFixture.get<AccountService>(AccountService);

    // User setup
    user = Keypair.generate();
    accessToken = await getAccessToken(authService, user);

    app = moduleFixture.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  beforeEach(() => {
    mockedDepositService.clearState();
  });

  // --- TEST REFUND BALANCE ---
  it('/payment/refund-balance (POST) - should refund user balance', async () => {
    // Simulate the user balance is 100
    const userBalance = 100;
    mockedDepositService.setUserBalance(userBalance);

    const response = await request(app.getHttpServer())
      .post('/payment/refund-balance')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: userBalance });

    expect(response.status).toBe(HttpStatus.CREATED);
    expect(response.body).toEqual({
      signature: mockedDepositService.mockedTransaction,
    });
    expect(mockedDepositService.userBalance.toNumber()).toBe(0);
  });

  it('/payment/refund-balance (POST) - should return error for insufficient balance', async () => {
    mockedDepositService.setUserBalance(0);

    const response = await request(app.getHttpServer())
      .post('/payment/refund-balance')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 1000 });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body.message).toBe(
      'Balance refunding failed. Insufficient balance',
    );
  });

  it('/payment/refund-balance (POST) - should return error if balance is frozen', async () => {
    // Simulate the user balance is frozen
    mockedDepositService.isBalanceFrozen = true;

    const response = await request(app.getHttpServer())
      .post('/payment/refund-balance')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: userBalance });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body.message).toBe(
      'Balance refunding failed. Balance is frozen',
    );
  });

  afterAll(async () => {
    await accountService.deleteAccount(user.publicKey.toString());
    await app.close();
  });
});
