import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { TranslationModule } from './translation/translation.module';
import { PrismaModule } from './prisma/prisma.module';
import { AccountModule } from 'src/account/account.module';
import { AuthModule } from 'src/auth/auth.module';
import { PaymentModule } from './payment/payment.module';
import { AcceptLanguageResolver, I18nModule } from 'nestjs-i18n';
import * as path from 'path';
import { WebSocketLanguageResolver } from './payment/resolvers/websocket.resolver';

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
        new WebSocketLanguageResolver(), // WebSocket language resolver
        AcceptLanguageResolver, // Accept-Language header resolver
      ],
    }),
    // Setup modules
    PrismaModule,
    AccountModule,
    AuthModule,
    TranslationModule,
    PaymentModule,
  ],
  providers: [
    TranslationModule,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    WebSocketLanguageResolver,
  ],
})
export class AppModule {}
