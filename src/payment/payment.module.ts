import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { CacheModule } from '@nestjs/cache-manager';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { AccountModule } from 'src/account/account.module';

@Module({
  imports: [
    CacheModule.register({
      ttl: 12 * 60 * 60 * 1000, // 12 hrs in ms
    }),
    ScheduleModule.forRoot(),
    JwtModule,
    AccountModule,
  ],
  providers: [PaymentService, JwtService],
  exports: [PaymentService],
})
export class PaymentModule {}
