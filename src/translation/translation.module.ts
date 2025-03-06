import { Module } from '@nestjs/common';
import { TranslationGateway } from './translation.gateway';
import { AccountModule } from 'src/account/account.module';
import { AuthModule } from 'src/auth/auth.module';
import { PaymentModule } from 'src/payment/payment.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  providers: [TranslationGateway],
  imports: [AccountModule, AuthModule, PaymentModule, ScheduleModule.forRoot()],
  exports: [TranslationGateway],
})
export class TranslationModule {}
