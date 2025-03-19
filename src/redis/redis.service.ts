import { Injectable, Logger } from '@nestjs/common';
import { Redis, RedisValue } from 'ioredis';
import { TranslationCache } from 'src/translation/constants/translation-cache.enum';
import 'dotenv/config';
import { TranslationGateway } from 'src/translation/translation.gateway';
import { ModuleRef } from '@nestjs/core';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private readonly redisEventSubscriber: Redis;
  private readonly prefixRegExp = /^.*:/;

  // Inject TranslationGateway manually to avoid circular dependency
  private readonly translationGateway = this.moduleRef.get<TranslationGateway>(
    TranslationGateway,
    { strict: false },
  );

  constructor(private readonly moduleRef: ModuleRef) {
    // Setup Redis connection for events subscription
    this.redisEventSubscriber = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD,
    });
  }

  async onModuleInit() {
    // Enable key expiration events
    await this.redisEventSubscriber.config(
      'SET',
      'notify-keyspace-events',
      'Ex',
    );

    // Subscribe to key expiration events
    await this.redisEventSubscriber.psubscribe('__keyevent@0__:expired');
    this.logger.log('Redis service subscribed to key expiration events');

    // Handle key expiration events
    this.redisEventSubscriber.on('pmessage', (pattern, channel, message) => {
      // Make Speechmatics API key available
      if (message.startsWith(TranslationCache.PREFIX)) {
        const apiKey = message.replace(this.prefixRegExp, ''); // Remove prefix
        this.translationGateway.makeApiKeyAvailable(apiKey);
      }
    });
  }

  async set(key: string, value: RedisValue, expiration?: number) {
    if (expiration && expiration > 0) {
      await this.redisEventSubscriber.set(key, value, 'EX', expiration);
    } else {
      await this.redisEventSubscriber.set(key, value);
    }
  }

  async get<T extends RedisValue>(key: string): Promise<T | null> {
    const value = await this.redisEventSubscriber.get(key);
    if (value === null) return null;
    return value as T;
  }

  async del(key: string) {
    await this.redisEventSubscriber.del(key);
  }
}
