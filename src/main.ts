import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule, ObserveInstrument } from './app.module.js';
import { getAllowedCorsOrigins, hasObserveOptions } from './config/environment.js';

async function bootstrap() {
  const options = hasObserveOptions()
    ? { instrument: ObserveInstrument }
    : {};
  const app = await NestFactory.create(AppModule, options);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  const corsOrigins = getAllowedCorsOrigins();
  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Idempotency-Key',
        'X-Requested-With',
      ],
      exposedHeaders: ['Content-Disposition'],
      credentials: false,
      maxAge: 86400,
    });
  }
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
