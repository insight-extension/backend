import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import 'dotenv/config';
import { AuthService } from 'src/auth/auth.service';
import { AccountService } from 'src/account/account.service';
import { Keypair } from '@solana/web3.js';
import { AuthRoutes } from 'src/auth/constants/auth-routes.enum';
import { getRefreshToken, getSignature } from './utils/helpers';
import { VerifyDto } from 'src/auth/dto/verify.dto';
import { VerifyResponseDto } from 'src/auth/dto/verify-response.dto';

describe('Auth Module (e2e)', () => {
  let app: INestApplication;
  let accountService: AccountService;
  let user: Keypair;
  let authService: AuthService;
  let refreshToken: string;
  // Setup before all tests
  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    authService = moduleFixture.get<AuthService>(AuthService);
    accountService = moduleFixture.get<AccountService>(AccountService);

    // User mock environment
    user = Keypair.generate();
    refreshToken = await getRefreshToken(authService, user);

    // Initialize the NestJS application
    app = moduleFixture.createNestApplication();
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

    const mockResponse: VerifyResponseDto = {
      accessToken: 'mockAccessToken',
      refreshToken: 'mockRefreshToken',
    };

    jest.spyOn(authService, 'verify').mockResolvedValue(mockResponse);

    const response = await request(app.getHttpServer())
      .post(`/${AuthRoutes.ROOT}/${AuthRoutes.VERIFY}`)
      .send(dto)
      .expect(HttpStatus.CREATED);

    expect(response.body).toEqual(mockResponse);
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

    expect(response.body.accessToken).toBe('newMockAccessToken');
    expect(response.body.refreshToken).toBe('newMockRefreshToken');
  });

  // --- TEST REFRESH TOKEN ---
  it('auth/refresh-token (POST) - fail (invalid token)', () => {
    return request(app.getHttpServer())
      .post(`/${AuthRoutes.ROOT}/${AuthRoutes.REFRESH_TOKEN}`)
      .send({ refreshToken: 'invalid-token' })
      .expect(HttpStatus.FORBIDDEN);
  });

  it('auth/refresh-token (POST) - success', async () => {
    const response = await request(app.getHttpServer())
      .post(`/${AuthRoutes.ROOT}/${AuthRoutes.REFRESH_TOKEN}`)
      .send({ refreshToken })
      .expect(HttpStatus.CREATED);

    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('refreshToken');
    expect(typeof response.body.accessToken).toBe('string');
    expect(typeof response.body.refreshToken).toBe('string');
  });

  // Cleanup after all tests
  afterEach(async () => {
    //await accountService.deleteAccount(user.publicKey.toString()); // Delete the account created during testing
    await app.close();
  });
});
