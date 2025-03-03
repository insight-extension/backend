import { ThrottlerModule } from '@nestjs/throttler';

// Limits each client to 10 requests per 1 second (ttl). excess requests will be throttled with a 429 error.
export const ThrottlerConfig = ThrottlerModule.forRoot([
  {
    ttl: 1,
    limit: 10,
  },
]);
