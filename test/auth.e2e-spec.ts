import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import 'dotenv/config';
import { AuthService } from 'src/auth/auth.service';
import { AccountService } from 'src/account/account.service';
import { Keypair } from '@solana/web3.js';
import { AuthRoutes } from 'src/auth/constants/auth-routes.enum';
import { getRefreshToken, getSignature } from './utils/auth.helper';
import { VerifyDto } from 'src/auth/dto/verify.dto';
import { VerifyResponseDto } from 'src/auth/dto/verify-response.dto';

describe('Auth Module (e2e)', () => {
  let app: INestApplication;
  let accountService: AccountService;
  let user: Keypair;
  let authService: AuthService;

  // Setup before all tests
  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    authService = moduleFixture.get<AuthService>(AuthService);
    accountService = moduleFixture.get<AccountService>(AccountService);

    // User mock environment
    user = Keypair.generate();

    // Initialize the NestJS application
    app = moduleFixture.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  // --- TEST CLAIM ---
  it('auth/claim (POST) - fail', () => {
    return request(app.getHttpServer())
      .post(`/${AuthRoutes.ROOT}/${AuthRoutes.CLAIM}`)
      .send({ publicKey: 'invalid-public-key' })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('auth/claim (POST) - success', async () => {
    const response = await request(app.getHttpServer())
      .post(`/${AuthRoutes.ROOT}/${AuthRoutes.CLAIM}`)
      .send({ publicKey: user.publicKey.toString() })
      .expect(HttpStatus.CREATED);

    expect(response.body).toHaveProperty('nonce');
    expect(typeof response.body.nonce).toBe('string');
  });

  // --- TEST VERIFY ---
  it('auth/verify (POST) - fail(invalid public key)', () => {
    return request(app.getHttpServer())
      .post(`/${AuthRoutes.ROOT}/${AuthRoutes.VERIFY}`)
      .send({
        publicKey: 'invalid-public-key',
        signature: getSignature(authService, user),
      })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('auth/verify (POST) - fail(invalid signature)', () => {
    return request(app.getHttpServer())
      .post(`/${AuthRoutes.ROOT}/${AuthRoutes.VERIFY}`)
      .send({
        publicKey: user.publicKey.toString(),
        signature: 'invalid-signature',
      })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('auth/verify (POST) - success', async () => {
    const dto: VerifyDto = {
      publicKey: user.publicKey.toString(),
      signature: await getSignature(authService, user),
    };

    const response = await request(app.getHttpServer())
      .post(`/${AuthRoutes.ROOT}/${AuthRoutes.VERIFY}`)
      .send(dto)
      .expect(HttpStatus.CREATED);
      
    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('refreshToken');
    await accountService.deleteAccount(user.publicKey.toString());
  });

  it('auth/verify (POST) - success (new account created)', async () => {
    const dto: VerifyDto = {
      publicKey: user.publicKey.toString(),
      signature: await getSignature(authService, user),
    };

    jest.spyOn(authService, 'verify').mockImplementation(async () => {
      const accountExists = await accountService.findOneByPublicKey(
        dto.publicKey,
      );
      if (!accountExists) {
        await accountService.saveAccount({ publicKey: dto.publicKey });
      }

      return {
        accessToken: 'newMockAccessToken',
        refreshToken: 'newMockRefreshToken',
      };
    });

    const response = await request(app.getHttpServer())
      .post(`/${AuthRoutes.ROOT}/${AuthRoutes.VERIFY}`)
      .send(dto)
      .expect(HttpStatus.CREATED);

    expect(
      accountService.findOneByPublicKey(user.publicKey.toString()),
    ).resolves.toBeTruthy();
    expect(response.body.accessToken).toBe('newMockAccessToken');
    expect(response.body.refreshToken).toBe('newMockRefreshToken');
    //await accountService.deleteAccount(user.publicKey.toString());
  });

  // --- TEST REFRESH TOKEN ---
  it('auth/refresh-token (POST) - fail (invalid token)', () => {
    return request(app.getHttpServer())
      .post(`/${AuthRoutes.ROOT}/${AuthRoutes.REFRESH_TOKEN}`)
      .send({ refreshToken: 'invalid-token' })
      .expect(HttpStatus.FORBIDDEN);
  });

  it('auth/refresh-token (POST) - success', async () => {
    const refreshToken = await getRefreshToken(authService, user);

    const response = await request(app.getHttpServer())
      .post(`/${AuthRoutes.ROOT}/${AuthRoutes.REFRESH_TOKEN}`)
      .send({ refreshToken })
      .expect(HttpStatus.CREATED);

    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('refreshToken');
    expect(typeof response.body.accessToken).toBe('string');
    expect(typeof response.body.refreshToken).toBe('string');

    await accountService.deleteAccount(user.publicKey.toString());
  });

  // Cleanup after all tests
  afterEach(async () => {
    await app.close();
  });
});
