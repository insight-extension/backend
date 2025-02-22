import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import 'dotenv/config';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  // SSL setup
  let httpsOptions = null;
  if (process.env.NODE_ENV === 'production') {
    httpsOptions = {
      key: fs.readFileSync(process.env.PRIVATE_KEY_PATH),
      cert: fs.readFileSync(process.env.CERTIFICATE_PATH),
    };
  }

  const app = await NestFactory.create(AppModule, {
    httpsOptions,
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe());
  app.enableCors();
  app.enableShutdownHooks();
  app.setGlobalPrefix('api');

  // setup swagger
  const config = new DocumentBuilder()
    .setTitle('Insight API')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/swagger', app, document);

  // setup port
  await app.listen(process.env.API_PORT || 11001);
}
bootstrap();
