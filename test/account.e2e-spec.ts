import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { AccountRoutes } from 'src/account/constants/account-routes.enum';
import 'dotenv/config';
import { AuthService } from 'src/auth/auth.service';
import { HttpHeaders } from 'src/utils/constants/http-headers.enum';
import { AccountService } from 'src/account/account.service';
import { Keypair } from '@solana/web3.js';
import { getAccessToken } from './utils/auth.helper';

describe('Account Module (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let accountService: AccountService;
  let user: Keypair;
  // Setup before all tests
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule], // Import the root AppModule
    }).compile();

    const authService = moduleFixture.get<AuthService>(AuthService);
    accountService = moduleFixture.get<AccountService>(AccountService);

    user = Keypair.generate();
    accessToken = await getAccessToken(authService, user);

    // Initialize the NestJS application
    app = moduleFixture.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe());
    await app.init(); // Initialize the app
  });

  // --- TEST FREE-HOURS-INFO ---
  // Test case for unauthorized access to the account/free-hours-info route
  it('account/free-hours-info (GET) - fail', () => {
    return request(app.getHttpServer())
      .get(`/${AccountRoutes.ROOT}/${AccountRoutes.FREE_HOURS_INFO}`)
      .expect(HttpStatus.UNAUTHORIZED); // Expect 401 Unauthorized status
  });

  // Test case for authorized access to the account/free-hours-info route
  it('account/free-hours-info (GET) - success', async () => {
    // Make a GET request to the endpoint with the authorization header
    const response = await request(app.getHttpServer())
      .get(`/${AccountRoutes.ROOT}/${AccountRoutes.FREE_HOURS_INFO}`)
      .set(HttpHeaders.AUTHORIZATION, `Bearer ${accessToken}`) // Set the Bearer token for authorization
      .expect(HttpStatus.OK); // Expect 200 OK status

    // Check that the response body contains the expected properties
    expect(response.body).toHaveProperty('freeHoursLeft');
    expect(response.body).toHaveProperty('freeHoursStartDate');

    // Verify the type of 'freeHoursLeft' is a number
    expect(typeof response.body.freeHoursLeft).toBe('number');

    // Verify the 'freeHoursStartDate' value:
    if (response.body.freeHoursStartDate === null) {
      // If 'freeHoursStartDate' is null, ensure it is explicitly null
      expect(response.body.freeHoursStartDate).toBeNull();
    } else {
      // If 'freeHoursStartDate' is not null, it should be a string (representing a date)
      expect(response.body.freeHoursStartDate).toEqual(expect.any(String));

      // Convert the string to a Date object and check if the date is valid
      const date = new Date(response.body.freeHoursStartDate);
      expect(date.getTime()).toBeGreaterThan(0); // Ensure the date is valid (timestamp > 0)
    }
  });

  // Cleanup after all tests
  afterAll(async () => {
    await accountService.deleteAccount(user.publicKey.toString()); // Delete the account created during testing
    await app.close();
  });
});
