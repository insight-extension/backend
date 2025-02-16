import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { TranslationModule } from './translation/translation.module';
import { PrismaModule } from './prisma/prisma.module';
import { AccountModule } from 'src/account/account.module';
import { AuthModule } from 'src/auth/auth.module';
import { PaymentModule } from './payment/payment.module';
import { AcceptLanguageResolver, I18nModule } from 'nestjs-i18n';
import { FaucetModule } from './faucet/faucet.module';
import * as path from 'path';
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    // Limits each client to 10 requests per 1 second (ttl). excess requests will be throttled with a 429 error.
    ThrottlerModule.forRoot([
      {
        ttl: 1,
        limit: 10,
      },
    ]),
    // i18n module for translations
    I18nModule.forRoot({
      fallbackLanguage: 'en', // Default language
      loaderOptions: {
        path: path.join(__dirname, '/i18n/'),
        watch: true,
      },
      resolvers: [
        AcceptLanguageResolver, // Accept-Language header resolver
      ],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        name: 'InsightBackend',
        level: 'trace',
        transport: {
          targets: [
            {
              level: 'trace',
              target: 'pino-pretty',
            },
            {
              level: process.env.NODE_ENV !== 'production' ? 'trace' : 'info',
              target: 'pino-loki',
              options: {
                batching: true,
                interval: 5,
                host: process.env.LOKI_URL,
                labels: {
                  app: process.env.LOKI_LABELS,
                  namespace: process.env.NODE_ENV || 'development',
                },
              },
            },
          ],
        },
      },
    }),
    // Setup modules
    PrismaModule,
    AccountModule,
    AuthModule,
    TranslationModule,
    PaymentModule,
    FaucetModule,
  ],
  providers: [
    TranslationModule,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
