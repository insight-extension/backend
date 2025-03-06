import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, ModuleRef } from '@nestjs/core';
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
import { FaucetRoutes } from './faucet/constants/faucet-routes.enum';
import { DepositProgramRoutes } from './deposit-program/constants/deposit-program-routes.enum';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    // Setup modules
    CacheModule.register({
      isGlobal: true,
      url: `redis://:admin@localhost:6379`,
      store: redisStore,
    }),
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
    RedisModule,
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
  // Make ModuleRef globally available to allow DI
  // without constructor (e.g. decorators)
  public static moduleRef: ModuleRef;
  constructor(private readonly moduleRef: ModuleRef) {
    AppModule.moduleRef = moduleRef;
  }

  // Middlewares configuration
  configure(consumer: MiddlewareConsumer) {
    // Apply API token auth middleware to the admin-only routes
    consumer
      .apply(AdminTokenAuthMiddleware)
      .forRoutes(
        `${FaucetRoutes.ROOT}/${FaucetRoutes.CONFIGURE}`,
        `${DepositProgramRoutes.ROOT}/${DepositProgramRoutes.UNFREEZE_BALANCE}`,
      );
  }
}
