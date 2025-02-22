import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { TranslationModule } from './translation/translation.module';
import { PrismaModule } from './prisma/prisma.module';
import { AccountModule } from 'src/account/account.module';
import { AuthModule } from 'src/auth/auth.module';
import { PaymentModule } from './payment/payment.module';
import { FaucetModule } from './faucet/faucet.module';
import { LoggerConfig } from './utils/configs/logger.config';
import { I18nConfig } from './utils/configs/i18n.config';
import { ThrottlerConfig } from './utils/configs/throttler.config';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

@Module({
  imports: [
    // Modules with configs
    ThrottlerConfig,
    I18nConfig,
    LoggerConfig,
    // Setup modules
    PrometheusModule.register({
      defaultLabels: {
        app: 'insight-prometheus',
      },
    }),
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
  exports: [PrometheusModule],
})
export class AppModule {}
