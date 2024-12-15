import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs'; // Import the 'fs' module
import path from 'path';
import 'dotenv/config';
// import helmet from 'helmet';

async function bootstrap() {
  // SSL setup
  const httpsOptions = {
    key: fs.readFileSync(process.env.PRIVATE_KEY_PATH),
    cert: fs.readFileSync(process.env.CERTIFICATE_PATH),
  };

  const app = await NestFactory.create(AppModule, { httpsOptions });
  // TODO: improve logger
  app.useLogger(new Logger());
  app.enableCors();
  app.setGlobalPrefix('api');
  // setup swagger
  const config = new DocumentBuilder()
    .setTitle('Insight API')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/swagger', app, document);
  // setup port
  await app.listen(process.env.API_PORT || 11001, () => {
    Logger.log(`Listening on port ${process.env.API_PORT || 11001}`);
  });
}
bootstrap();
