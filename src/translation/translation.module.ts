import { Module } from '@nestjs/common';
import { TranslationGateway } from './translation.gateway';
import { AccountModule } from 'src/account/account.module';
import { AuthModule } from 'src/auth/auth.module';
import { PaymentModule } from 'src/payment/payment.module';
import { makeCounterProvider } from '@willsoto/nestjs-prometheus';

@Module({
  providers: [
    TranslationGateway,
    makeCounterProvider({
      name: 'translation_starts_total',
      help: 'Number of translation starts',
    }),
  ],
  imports: [AccountModule, AuthModule, PaymentModule],
})
export class TranslationModule {}
