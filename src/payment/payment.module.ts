import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { CacheModule } from '@nestjs/cache-manager';
import { JwtModule, JwtService } from '@nestjs/jwt';

@Module({
  imports: [
    CacheModule.register({
      ttl: 12 * 60 * 60 * 1000, // 12 hrs in ms
    }),
    JwtModule,
  ],
  providers: [PaymentService, JwtService],
})
export class PaymentModule {}
