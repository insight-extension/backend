import { Module } from '@nestjs/common';
import { FaucetService } from './faucet.service';
import { FaucetController } from './faucet.controller';

@Module({
  controllers: [FaucetController],
  providers: [FaucetService],
})
export class FaucetModule {}
