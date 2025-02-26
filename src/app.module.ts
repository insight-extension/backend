import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { TranslationModule } from './translation/translation.module';
import { PrismaModule } from './prisma/prisma.module';
import { AccountModule } from 'src/account/account.module';
import { AuthModule } from 'src/auth/auth.module';
import { PaymentModule } from './payment/payment.module';
import { FaucetModule } from './faucet/faucet.module';
import { DepositProgramModule } from './deposit-program/deposit-program.module';
import { AdminTokenAuthMiddleware } from './utils/middlewares/admin-token-auth.middleware';
import { ThrottlerConfig } from './utils/configs/throttler.config';
import { I18nConfig } from './utils/configs/i18n.config';
import { LoggerConfig } from './utils/configs/logger.config';

@Module({
  imports: [
    // Setup modules
    PrismaModule,
    AccountModule,
    AuthModule,
    TranslationModule,
    PaymentModule,
    FaucetModule,
    DepositProgramModule,
    // Modules with configuration
    ThrottlerConfig,
    I18nConfig,
    LoggerConfig,
  ],
  providers: [
    TranslationModule,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply API token auth middleware to the admin-only routes
    consumer
      .apply(AdminTokenAuthMiddleware)
      .forRoutes('faucet/configure', 'deposit-program/unfreeze-balance');
  }
}
