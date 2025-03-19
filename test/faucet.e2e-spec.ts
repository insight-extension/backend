import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { FaucetService } from 'src/faucet/faucet.service';
import { HttpHeaders } from 'src/utils/constants/http-headers.enum';
import { AppModule } from 'src/app.module';
import { Keypair } from '@solana/web3.js';
import { getAccessToken } from './utils/auth.helper';
import { AuthService } from 'src/auth/auth.service';
import { AccountService } from 'src/account/account.service';

describe('Faucet Module', () => {
  let app: INestApplication;
  let faucetService: FaucetService;
  let accessToken: string;
  let user: Keypair;
  let authService: AuthService;
  let accountService: AccountService;
  const mockSignature = 'tx123';
  let ip = '::ffff:127.0.0.1';

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    authService = moduleFixture.get<AuthService>(AuthService);
    faucetService = moduleFixture.get<FaucetService>(FaucetService);
    accountService = moduleFixture.get<AccountService>(AccountService);

    // Mock chain interaction
    jest
      .spyOn(faucetService as any, 'claimUsdcThroughProgram')
      .mockResolvedValue(mockSignature);

    user = Keypair.generate();
    accessToken = await getAccessToken(authService, user);

    app = moduleFixture.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  // --- TEST CLAIM ---
  it('should allow a user to claim USDC', async () => {
    const response = await request(app.getHttpServer())
      .post('/faucet/claim')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(HttpStatus.CREATED);

    expect(response.body).toEqual({
      signature: mockSignature,
    });
  });

  it('should throw ForbiddenException if IP already claimed faucet', async () => {
    // Mocking the IP cache behavior to simulate a claim made already
    await request(app.getHttpServer())
      .post('/faucet/claim')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(HttpStatus.CREATED);

    await request(app.getHttpServer())
      .post('/faucet/claim')
      .set(HttpHeaders.AUTHORIZATION, `Bearer ${accessToken}`)
      .expect(HttpStatus.FORBIDDEN)
      .expect({
        message:
          'You have already claimed your free tokens during the last 24 hours. The next claim will be available in 24 hours',
        error: 'Forbidden',
        statusCode: HttpStatus.FORBIDDEN,
      });
  });

  afterEach(async () => {
    await accountService.deleteAccount(user.publicKey.toString());
    await (faucetService as any).deleteIpFromCache(ip);
    await app.close();
  });
});
