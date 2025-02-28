import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PaymentService } from '../src/payment/payment.service';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAccessToken } from './utils/helpers';
import { AuthService } from 'src/auth/auth.service';
import { AccountService } from 'src/account/account.service';
import { DepositProgramService } from 'src/deposit-program/deposit-program.service';
import { GetUserInfo } from 'src/deposit-program/types/get-user-info.type';

describe('PaymentController (e2e)', () => {
  let app: INestApplication;
  let paymentService: PaymentService;
  let user: Keypair;
  let accessToken: string;
  let authService: AuthService;
  let accountService: AccountService;
  const mockSignature = 'tx123';
  const userBalance = 100;

  // Mock service to avoid interacting with the Solana network
  const mockDepositProgramService = {
    getUserInfoAddress: jest.fn(),
    getUserInfo: jest.fn(),
    getUserVaultAddress: jest.fn(),
    getUserVaultBalance: jest.fn(),
    refundBalance: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DepositProgramService) // Override the DepositProgramService provider
      .useValue(mockDepositProgramService)
      .compile();

    paymentService = moduleFixture.get<PaymentService>(PaymentService);
    authService = moduleFixture.get<AuthService>(AuthService);
    accountService = moduleFixture.get<AccountService>(AccountService);

    // Mock chain interaction
    jest
      .spyOn(mockDepositProgramService, 'refundBalance')
      .mockResolvedValue(mockSignature);

    jest
      .spyOn(mockDepositProgramService, 'getUserVaultAddress')
      .mockResolvedValue(Keypair.generate().publicKey);

    jest
      .spyOn(mockDepositProgramService, 'getUserInfoAddress')
      .mockReturnValue(Keypair.generate().publicKey);

    jest
      .spyOn(mockDepositProgramService, 'getUserVaultBalance')
      .mockResolvedValue(userBalance);

    // User setup
    user = Keypair.generate();
    accessToken = await getAccessToken(authService, user);

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  it('/payment/refund-balance (POST) - should refund user balance', async () => {
    const mockedUserInfo: GetUserInfo = {
      perHourLeft: 0,
      isBalanceFrozen: false,
      bump: 123,
    };

    jest
      .spyOn(mockDepositProgramService, 'getUserInfo')
      .mockResolvedValue(mockedUserInfo);

    const response = await request(app.getHttpServer())
      .post('/payment/refund-balance')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 100 });

    expect(response.status).toBe(HttpStatus.CREATED);
    expect(response.body).toEqual({ signature: mockSignature });
  });

  it('/payment/refund-balance (POST) - should return error for insufficient balance', async () => {
    const mockedUserInfo: GetUserInfo = {
      perHourLeft: 0,
      isBalanceFrozen: false,
      bump: 123,
    };
    jest
      .spyOn(mockDepositProgramService, 'getUserInfo')
      .mockResolvedValue(mockedUserInfo);

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
    const mockedUserInfo: GetUserInfo = {
      perHourLeft: 0,
      isBalanceFrozen: true,
      bump: 123,
    };

    // Mock the getUserInfo method to return a frozen balance
    // Without interacting with the Solana network
    jest
      .spyOn(mockDepositProgramService, 'getUserInfo')
      .mockResolvedValue(mockedUserInfo);

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
