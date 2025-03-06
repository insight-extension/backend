import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { AccountModule } from 'src/account/account.module';
import { PaymentController } from './payment.controller';
import { DepositProgramService } from 'src/deposit-program/deposit-program.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    JwtModule,
    AccountModule,
  ],
  providers: [PaymentService, JwtService, DepositProgramService],
  exports: [PaymentService],
  controllers: [PaymentController],
})
export class PaymentModule {}
