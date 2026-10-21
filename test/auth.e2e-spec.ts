import {
  ConflictException,
  INestApplication,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createHash, randomUUID } from 'node:crypto';
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
class AuthenticationE2eModule {}

describe('Authentication HTTP flows (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const deliveries: TestDelivery[] = [];
  const fixtureEmails: string[] = [];

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      imports: [AuthenticationE2eModule],
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

  it('persists registration, consumes verification once, authenticates, revokes sessions, and resets passwords safely', async () => {
    const email = `auth-e2e-${randomUUID()}@example.test`;
    const phone = `+2519${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const password = 'Correct-Hulegeb-Password-1!';
    fixtureEmails.push(email);

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: email.toUpperCase(),
        phone,
        password,
        firstName: ' Test ',
        lastName: ' Buyer ',
        termsVersion: 'test-terms-v1',
        acceptedTerms: true,
      })
      .expect(201);

    expect(JSON.stringify(registration.body)).not.toContain(password);
    expect(registration.body).not.toHaveProperty('accessToken');
    expect(registration.body).not.toHaveProperty('token');

    const storedUser = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { userRoles: { include: { role: true } } },
    });
    expect(storedUser.status).toBe('PENDING_VERIFICATION');
    expect(storedUser.passwordHash).not.toBe(password);
    expect(storedUser.termsAcceptedAt).toBeInstanceOf(Date);
    expect(storedUser.userRoles.map(({ role }) => role.code)).toContain('BUYER');

    const challenges = await prisma.authChallenge.findMany({
      where: { userId: storedUser.id },
    });
    expect(challenges).toHaveLength(2);
    expect(challenges.every(({ tokenHash }) => !tokenHash.includes(password))).toBe(
      true,
    );
    const emailDelivery = deliveries.find(
      (delivery) => delivery.event === 'verify-email',
    );
    const phoneDelivery = deliveries.find(
      (delivery) => delivery.event === 'verify-phone',
    );
    expect(emailDelivery).toBeDefined();
    expect(phoneDelivery).toBeDefined();

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email,
        phone: `+2519${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        password,
        firstName: 'Duplicate',
        lastName: 'Email',
        termsVersion: 'test-terms-v1',
        acceptedTerms: true,
      })
      .expect(409);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `auth-e2e-${randomUUID()}@example.test`,
        phone,
        password,
        firstName: 'Duplicate',
        lastName: 'Phone',
        termsVersion: 'test-terms-v1',
        acceptedTerms: true,
      })
      .expect(409);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: email, password })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/verify-phone')
      .send({ phone, code: '000000' })
      .expect(400);
    expect(
      await prisma.authChallenge.findFirstOrThrow({
        where: { userId: storedUser.id, type: 'PHONE_VERIFICATION' },
      }),
    ).toMatchObject({ attempts: 1, consumedAt: null });

    await request(app.getHttpServer())
      .post('/auth/verify-phone')
      .send({ phone, code: phoneDelivery!.token })
      .expect(201);
    const phoneVerifiedUser = await prisma.user.findUniqueOrThrow({
      where: { id: storedUser.id },
    });
    expect(phoneVerifiedUser.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(phoneVerifiedUser.status).toBe('PENDING_VERIFICATION');

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: 'invalid-email-token' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: emailDelivery!.token })
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: emailDelivery!.token })
      .expect(400);

    const activeUser = await prisma.user.findUniqueOrThrow({
      where: { id: storedUser.id },
    });
    expect(activeUser.status).toBe('ACTIVE');
    expect(activeUser.emailVerifiedAt).toBeInstanceOf(Date);
    const emailChallenge = await prisma.authChallenge.findUniqueOrThrow({
      where: {
        tokenHash: createHash('sha256')
          .update(emailDelivery!.token)
          .digest('hex'),
      },
    });
    expect(emailChallenge.consumedAt).toBeInstanceOf(Date);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: email, password })
      .expect(201);
    const firstToken = login.body.accessToken as string;
    const firstSession = await prisma.authSession.findFirstOrThrow({
      where: { userId: storedUser.id, revokedAt: null },
    });
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${firstToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch('/auth/me')
      .set('Authorization', `Bearer ${firstToken}`)
      .send({ firstName: 'Test', lastName: 'Buyer', unexpected: true })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${firstToken}`)
      .expect(201);
    expect(
      (await prisma.authSession.findUniqueOrThrow({
        where: { id: firstSession.id },
      })).revokedAt,
    ).toBeInstanceOf(Date);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${firstToken}`)
      .expect(401);

    const secondLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: email, password })
      .expect(201);
    const secondToken = secondLogin.body.accessToken as string;
    const secondSession = await prisma.authSession.findFirstOrThrow({
      where: { userId: storedUser.id, revokedAt: null },
    });
    await request(app.getHttpServer())
      .post('/auth/password/forgot')
      .send({ email })
      .expect(201);

    const expiredToken = `expired-${randomUUID()}`;
    await prisma.authChallenge.create({
      data: {
        userId: storedUser.id,
        type: 'PASSWORD_RESET',
        tokenHash: createHash('sha256').update(expiredToken).digest('hex'),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await request(app.getHttpServer())
      .post('/auth/password/reset')
      .send({ token: 'unknown-reset-token', newPassword: 'New-Hulegeb-Password-3!' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/password/reset')
      .send({ token: expiredToken, newPassword: 'New-Hulegeb-Password-3!' })
      .expect(400);

    const resetDelivery = deliveries.findLast(
      (delivery) => delivery.event === 'reset-password',
    );
    expect(resetDelivery).toBeDefined();
    const newPassword = 'New-Hulegeb-Password-3!';
    await request(app.getHttpServer())
      .post('/auth/password/reset')
      .send({ token: resetDelivery!.token, newPassword })
      .expect(201);
    const resetSession = await prisma.authSession.findUniqueOrThrow({
      where: { id: secondSession.id },
    });
    expect(resetSession.revokedAt).toBeInstanceOf(Date);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${secondToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/password/reset')
      .send({ token: resetDelivery!.token, newPassword })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: email, password })
      .expect(401);

    const newLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: email, password: newPassword })
      .expect(201);
    expect(newLogin.body).toHaveProperty('accessToken');
    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: storedUser.id },
    });
    expect(updatedUser.passwordHash).not.toBe(storedUser.passwordHash);

    const concurrentEmail = `auth-e2e-${randomUUID()}@example.test`;
    fixtureEmails.push(concurrentEmail);
    const concurrentRegistration = {
      email: concurrentEmail,
      phone: `+2519${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      password,
      firstName: 'Concurrent',
      lastName: 'Registration',
      termsVersion: 'test-terms-v1',
      acceptedTerms: true,
    };
    const raceResults = await Promise.allSettled([
      app.get(AuthService).register(concurrentRegistration),
      app.get(AuthService).register(concurrentRegistration),
    ]);
    expect(
      raceResults.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    const rejectedRace = raceResults.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected',
    );
    expect(rejectedRace?.reason).toBeInstanceOf(ConflictException);
    expect(
      await prisma.user.count({ where: { email: concurrentEmail } }),
    ).toBe(1);
  });
});
