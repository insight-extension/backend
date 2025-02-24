import { Module } from '@nestjs/common';
import { TranslationGateway } from './translation.gateway';
import { AccountModule } from 'src/account/account.module';
import { AuthModule } from 'src/auth/auth.module';
import { PaymentModule } from 'src/payment/payment.module';
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeSummaryProvider,
} from '@willsoto/nestjs-prometheus';
import { TranslationMetrics } from './constants/translation-metrics.enum';
import { TranslationMetricLabels } from './constants/translation-metric-labels.enum';

@Module({
  providers: [
    TranslationGateway,
    // Prometheus metrics
    makeCounterProvider({
      name: TranslationMetrics.TRANSLATION_STARTS,
      help: 'Number of translation starts',
    }),
    makeGaugeProvider({
      name: TranslationMetrics.ACTIVE_TRANSLATIONS,
      help: 'Shows how much users using translation at the moment',
    }),
    makeSummaryProvider({
      name: TranslationMetrics.TRANSLATION_DELAY,
      help: 'Shows how much time it takes to translate a text',
      labelNames: [TranslationMetricLabels.SERVICE],
      maxAgeSeconds: 600,
      ageBuckets: 5,
    }),
    makeSummaryProvider({
      name: TranslationMetrics.TRANSLATION_USING,
      help: 'Shows how much time users using translation',
      labelNames: [TranslationMetricLabels.SUBSCRIPTION_TYPE],
      maxAgeSeconds: 600,
      ageBuckets: 5,
    }),
  ],
  imports: [AccountModule, AuthModule, PaymentModule],
})
export class TranslationModule {}
