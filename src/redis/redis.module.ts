import { Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { TranslationModule } from 'src/translation/translation.module';
import { TranslationGateway } from 'src/translation/translation.gateway';

@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
