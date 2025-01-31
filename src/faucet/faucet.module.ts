import { Module } from '@nestjs/common';
import { FaucetService } from './faucet.service';
import { FaucetController } from './faucet.controller';
import { CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    CacheModule.register({
      ttl: 24 * 60 * 60 * 1000, // 24 hrs in ms
    }),
  ],
  controllers: [FaucetController],
  providers: [FaucetService],
})
export class FaucetModule {}
