import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { TranslationGateway } from 'src/translation/translation.gateway';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AccountService } from 'src/account/account.service';
import { Keypair } from '@solana/web3.js';
import { AuthService } from 'src/auth/auth.service';
import 'dotenv/config';
import { io } from 'socket.io-client';
import { getAccessToken } from './utils/auth.helper';
import { WsEvents } from 'src/translation/constants/ws-events.enum';
import { time } from 'console';

const PORT = process.env.API_PORT || 11000;
let app: INestApplication;
let translationGateway: TranslationGateway;
let accountService: AccountService;
let authService: AuthService;
let user: Keypair;
let accessToken: string;
let clientSocket;
const mockAudioBuffer = new Uint8Array([0, 255, 128, 64, 32, 16, 8, 4, 2, 1]);

describe('Translation Module E2E', () => {
  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    translationGateway =
      moduleFixture.get<TranslationGateway>(TranslationGateway);
    accountService = moduleFixture.get<AccountService>(AccountService);
    authService = moduleFixture.get<AuthService>(AuthService);

    user = Keypair.generate();
    accessToken = await getAccessToken(authService, user);

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
    await app.listen(PORT);
  });

  it('Should connect to server', (done) => {
    clientSocket = io(`http://localhost:${PORT}`);
    clientSocket.on('connect', () => {
      expect(clientSocket.connected).toBe(true);
    });
    done();
  });

  it('Should get unauthorized error', async () => {
    clientSocket = io(`http://localhost:${PORT}`, {
      transportOptions: {
        polling: {
          extraHeaders: {
            Authorization: `Bearer invalid-token`,
            Subscription: `freeTrial`,
          },
        },
      },
    });
    let socketError;
    clientSocket.on('error', (error) => {
      socketError = error;
    });
    await sleep(500);
    clientSocket.emit(WsEvents.AUDIO_DATA, mockAudioBuffer);

    // const error = await errorPromise;
    expect(socketError.message).toBe('Error while authenticating user');
  });

  afterEach(async () => {
    await app.close();
    clientSocket.close();
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
