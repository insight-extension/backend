import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { TranslationCache } from 'src/translation/constants/translation-cache.enum';
import 'dotenv/config';
import { TranslationGateway } from 'src/translation/translation.gateway';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private readonly redis: Redis;
  private readonly prefixRegExp = /^.*:/;

  // Setup Redis connection
  constructor(private readonly translationGateway: TranslationGateway) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD,
    });
  }

  async onModuleInit() {
    // Enable key expiration events
    await this.redis.config('SET', 'notify-keyspace-events', 'Ex');

    // Subscribe to key expiration events
    await this.redis.psubscribe('__keyevent@0__:expired');
    this.logger.log('Redis service subscribed to key expiration events');

    // Handle key expiration events
    this.redis.on('pmessage', (pattern, channel, message) => {
      // Make Speechmatics API key available
      if (message.startsWith(TranslationCache.PREFIX)) {
        const apiKey = message.replace(this.prefixRegExp, ''); // Remove prefix
        this.translationGateway.makeApiKeyAvailable(apiKey);
      }
    });
  }
}
