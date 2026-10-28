import {
  INestApplication,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuthDeliveryService } from '../src/auth/auth-delivery.service.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { AuthorizationModule } from '../src/authorization/authorization.module.js';
import { RolesGuard } from '../src/authorization/roles.guard.js';
import { AuthenticationGuard } from '../src/auth/authentication.guard.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

interface TestDelivery {
  event: string;
  recipient: string;
  token: string;
  verificationUrl?: string;
  expiresInSeconds: number;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    AuthModule,
    AuthorizationModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
class AuthenticationRefreshE2eModule {}

describe('Authentication refresh token flows (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const deliveries: TestDelivery[] = [];
  const fixtureEmails: string[] = [];

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      imports: [AuthenticationRefreshE2eModule],
    })
      .overrideProvider(AuthDeliveryService)
      .useValue({
        assertEmailAndSmsConfigured: () => undefined,
        assertSmsConfigured: () => undefined,
        sendEmail: async (delivery: TestDelivery) => {
          deliveries.push(delivery);
        },
        sendSms: async (delivery: TestDelivery) => {
          deliveries.push(delivery);
        },
      })
      .compile();

    app = testingModule.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    prisma = app.get(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    if (fixtureEmails.length > 0) {
      await prisma.user.deleteMany({
        where: { email: { in: fixtureEmails } },
      });
    }
    if (typeof app !== 'undefined') {
      await app.close();
    }
  });

  async function registerAndVerify() {
    const email = `auth-refresh-${randomUUID()}@example.test`;
    const phone = `+2519${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const password = 'Correct-Hulegeb-Password-1!';
    fixtureEmails.push(email);

    const before = deliveries.length;
    await app.get(AuthService).register({
      email,
      phone,
      password,
      firstName: 'Refresh',
      lastName: 'Buyer',
      termsVersion: 'test-terms-v1',
      acceptedTerms: true,
    });

    const newDeliveries = deliveries.slice(before);
    const emailDelivery = newDeliveries.find(
      (delivery) => delivery.event === 'verify-email',
    );
    const phoneDelivery = newDeliveries.find(
      (delivery) => delivery.event === 'verify-phone',
    );
    expect(emailDelivery).toBeDefined();
    expect(phoneDelivery).toBeDefined();

    await app.get(AuthService).verifyPhone(phone, phoneDelivery!.token);
    await app.get(AuthService).verifyEmail(emailDelivery!.token);

    const login = await app.get(AuthService).login(email, password);

    return {
      email,
      password,
      phone,
      accessToken: login.accessToken as string,
      refreshToken: login.refreshToken as string,
    };
  }

  it('returns a usable access token and a new refresh token', async () => {
    const user = await registerAndVerify();

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(201);

    expect(refreshed.body).toHaveProperty('accessToken');
    expect(refreshed.body).toHaveProperty('refreshToken');
    expect(refreshed.body.refreshToken).not.toBe(user.refreshToken);
    expect(refreshed.body.tokenType).toBe('Bearer');

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .expect(200);
  });

  it('rejects the old refresh token after rotation', async () => {
    const user = await registerAndVerify();

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
  });

  it('rejects invalid, expired, and revoked refresh tokens', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'definitely-not-a-valid-refresh-token' })
      .expect(401);

    const expiredUser = await registerAndVerify();
    const expiredDbUser = await prisma.user.findUniqueOrThrow({
      where: { email: expiredUser.email },
    });
    const expiredSession = await prisma.authSession.findFirstOrThrow({
      where: { userId: expiredDbUser.id, revokedAt: null },
    });
    await prisma.authSession.update({
      where: { id: expiredSession.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: expiredUser.refreshToken })
      .expect(401);

    const revokedUser = await registerAndVerify();
    const revokedDbUser = await prisma.user.findUniqueOrThrow({
      where: { email: revokedUser.email },
    });
    await prisma.authSession.updateMany({
      where: { userId: revokedDbUser.id, revokedAt: null },
      data: { revokedAt: new Date(), refreshTokenHash: null },
    });
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: revokedUser.refreshToken })
      .expect(401);
  });

  it('rejects refresh after logout and password reset', async () => {
    const loggedOutUser = await registerAndVerify();
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${loggedOutUser.accessToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: loggedOutUser.refreshToken })
      .expect(401);

    const resetUser = await registerAndVerify();
    await app.get(AuthService).requestPasswordReset({ email: resetUser.email });
    const resetDelivery = deliveries.findLast(
      (delivery) => delivery.event === 'reset-password',
    );
    expect(resetDelivery).toBeDefined();
    await request(app.getHttpServer())
      .post('/auth/password/reset')
      .send({ token: resetDelivery!.token, newPassword: 'New-Hulegeb-Password-3!' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: resetUser.refreshToken })
      .expect(401);
  });

  it('prevents concurrent refresh token rotation', async () => {
    const user = await registerAndVerify();

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: user.refreshToken }),
      request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: user.refreshToken }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 401]);

    const success = first.status === 201 ? first : second;
    expect(success.body).toHaveProperty('accessToken');
    expect(success.body).toHaveProperty('refreshToken');
  });
});


