import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppController } from '../src/app.controller.js';
import { AppService } from '../src/app.service.js';

@Module({
  controllers: [AppController],
  providers: [AppService],
})
class E2eAppModule {}

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await NestFactory.create(E2eAppModule, { logger: false });
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterAll(async () => {
    await app.close();
  });
});
