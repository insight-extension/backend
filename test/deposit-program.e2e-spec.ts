import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DepositProgramService } from '../src/deposit-program/deposit-program.service';
import { DepositProgramRoutes } from '../src/deposit-program/constants/deposit-program-routes.enum';
import { UnfreezeBalanceDto } from '../src/deposit-program/dto/unfreeze-balance.dto';
import 'dotenv/config';
import { Keypair } from '@solana/web3.js';
import { HttpHeaders } from 'src/utils/constants/http-headers.enum';

describe('DepositProgram Module (e2e)', () => {
  let app: INestApplication;
  let depositProgramService: DepositProgramService;
  const adminToken = process.env.ADMIN_AUTH_TOKEN;
  let user: Keypair;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    depositProgramService = moduleFixture.get<DepositProgramService>(
      DepositProgramService,
    );

    user = Keypair.generate();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // --- TEST UNFREEZE BALANCE ---
  it('POST /deposit-program/unfreeze-balance - fail (unauthorized)', () => {
    return request(app.getHttpServer())
      .post(
        `/${DepositProgramRoutes.ROOT}/${DepositProgramRoutes.UNFREEZE_BALANCE}`,
      )
      .send({ publicKey: 'invalid-public-key' })
      .set(HttpHeaders.AUTHORIZATION, `Bearer invalid-token`)
      .expect(HttpStatus.UNAUTHORIZED);
  });

  it('POST /deposit-program/unfreeze-balance - fail (invalid public key)', () => {
    return request(app.getHttpServer())
      .post(
        `/${DepositProgramRoutes.ROOT}/${DepositProgramRoutes.UNFREEZE_BALANCE}`,
      )
      .send({ publicKey: 'invalid-public-key' })
      .set(HttpHeaders.AUTHORIZATION, `Bearer ${adminToken}`)
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('POST /deposit-program/unfreeze-balance - success', async () => {
    const dto: UnfreezeBalanceDto = { publicKey: user.publicKey.toString() };

    jest.spyOn(depositProgramService, 'unfreezeBalance').mockResolvedValue({
      transaction: 'mockTransactionSignature',
    });

    const response = await request(app.getHttpServer())
      .post(
        `/${DepositProgramRoutes.ROOT}/${DepositProgramRoutes.UNFREEZE_BALANCE}`,
      )
      .send(dto)
      .set(HttpHeaders.AUTHORIZATION, `Bearer ${adminToken}`)
      .expect(HttpStatus.CREATED);

    expect(response.body).toHaveProperty('transaction');
    expect(response.body.transaction).toBe('mockTransactionSignature');
  });
});
