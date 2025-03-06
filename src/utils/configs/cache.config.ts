// import { CacheModule } from '@nestjs/cache-manager';
// import { CacheableMemory, Keyv } from 'cacheable';
// import { createKeyv } from '@keyv/redis';

// const ttl = 600 * 1000; // 10 minutes
// const lruSize = 5000; // 5000 items
// const url = process.env.REDIS_URL;
// const password = process.env.REDIS_PASSWORD;
// const dbName = '0'; // Default database name

// export const CacheConfig = CacheModule.registerAsync({
//   isGlobal: true,
//   useFactory: async () => ({
//     stores: [
//       new Keyv({
//         store: new CacheableMemory({ ttl: 60000, lruSize: 5000 }),
//       }),
//       createKeyv('redis://:admin@localhost:6379/0'),
//     ],
//   }),
// });
