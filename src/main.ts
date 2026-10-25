import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { hasObserveOptions } from './config/environment.js';

async function bootstrap() {
  const options = hasObserveOptions()
    ? { instrument: ObserveInstrument }
    : {};
  const app = await NestFactory.create(AppModule, options);
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
