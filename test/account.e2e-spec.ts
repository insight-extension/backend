import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { AccountRoutes } from 'src/account/constants/account-routes.enum';
import 'dotenv/config';

const APP_URL = `http://localhost:${process.env.API_PORT}/`;

describe('Account Module (e2e)', () => {
  let app: INestApplication;
  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    await app.listen(process.env.API_PORT);
  });

  it('account/free-hours-info (GET)', () => {
    return request(APP_URL)
      .get(`${AccountRoutes.ROOT}/${AccountRoutes.FREE_HOURS_INFO}`)
      .expect(HttpStatus.UNAUTHORIZED);
  });

  afterAll(async () => {
    await app.close();
  });
});
