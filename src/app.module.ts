import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { TranslationModule } from './translation/translation.module';
import { AccountModule } from 'src/account/account.module';
import { AuthModule } from 'src/auth/auth.module';
import { PaymentModule } from './payment/payment.module';
import { FaucetModule } from './faucet/faucet.module';
import { LoggerConfig } from './utils/configs/logger.config';
import { I18nConfig } from './utils/configs/i18n.config';
import { ThrottlerConfig } from './utils/configs/throttler.config';
import { MetricsMiddleware } from './utils/middlewares/metrics.middleware';
import {
  MetricsMiddlewareCounterProvider as MetricsMiddlewareCounterProvider,
  MetricsMiddlewareSummaryProvider,
} from './utils/configs/metrics-middleware.config';
import { PrometheusConfig } from './utils/configs/prometheus.config';

@Module({
  imports: [
    // Modules with configs
    ThrottlerConfig,
    I18nConfig,
    LoggerConfig,
    PrometheusConfig,
    // Setup modules
    AccountModule,
    AuthModule,
    TranslationModule,
    PaymentModule,
    FaucetModule,
    DiscoveryModule,
  ],
  providers: [
    TranslationModule,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    MetricsMiddlewareCounterProvider,
    MetricsMiddlewareSummaryProvider,
  ],
  exports: [PrometheusConfig],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(MetricsMiddleware)
      .exclude({ path: 'metrics', method: RequestMethod.GET }) // Exclude metrics endpoint
      .forRoutes('*');
  }
}
