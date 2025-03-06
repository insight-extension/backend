import { Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { TranslationModule } from 'src/translation/translation.module';

@Module({
  imports: [TranslationModule],
  providers: [RedisService],
})
export class RedisModule {}
