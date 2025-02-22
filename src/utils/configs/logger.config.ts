import { LoggerModule } from 'nestjs-pino';

export const LoggerConfig = LoggerModule.forRoot({
  pinoHttp: {
    name: 'InsightBackend',
    level: 'trace',
    transport: {
      targets: [
        {
          level: 'trace',
          target: 'pino-pretty',
        },
        {
          level: process.env.NODE_ENV !== 'production' ? 'trace' : 'info',
          target: 'pino-loki',
          options: {
            batching: true,
            interval: 5,
            host: process.env.LOKI_URL,
            labels: {
              app: process.env.LOKI_LABELS,
              namespace: process.env.NODE_ENV || 'development',
            },
          },
        },
      ],
    },
  },
});
