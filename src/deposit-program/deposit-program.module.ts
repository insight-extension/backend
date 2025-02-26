import { Module } from '@nestjs/common';
import { DepositProgramService } from './deposit-program.service';
import { DepositProgramController } from './deposit-program.controller';

@Module({
  controllers: [DepositProgramController],
  providers: [DepositProgramService],
  exports: [DepositProgramService],
})
export class DepositProgramModule {}
