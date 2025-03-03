import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { CacheModule } from '@nestjs/cache-manager';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { AccountModule } from 'src/account/account.module';
import { PaymentController } from './payment.controller';
import { DepositProgramService } from 'src/deposit-program/deposit-program.service';

@Module({
  imports: [
    CacheModule.register({
      ttl: 12 * 60 * 60 * 1000, // 12 hrs in ms
    }),
    ScheduleModule.forRoot(),
    JwtModule,
    AccountModule,
  ],
  providers: [PaymentService, JwtService, DepositProgramService],
  exports: [PaymentService],
  controllers: [PaymentController],
})
export class PaymentModule {}
