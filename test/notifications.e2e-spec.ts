import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { AuthenticationGuard } from '../src/auth/authentication.guard.js';
import { AuthorizationModule } from '../src/authorization/authorization.module.js';
import { RolesGuard } from '../src/authorization/roles.guard.js';
import { NotificationsModule } from '../src/notifications/notifications.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { configureAuthTestDatabase } from './auth-test-database.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    AuthModule,
    AuthorizationModule,
    NotificationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
class NotificationsE2eModule {}

describe('Notifications HTTP flow (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;
  let fixture:
    | {
        userIds: string[];
        sessionIds: string[];
        notificationIds: string[];
      }
    | undefined;

  async function createSession() {
    if (!fixture) {
      throw new Error('Notifications e2e fixture was not initialized.');
    }

    const user = await prisma.user.create({
      data: {
        email: `notifications-e2e-${randomUUID()}@example.test`,
        passwordHash: 'not-used-by-this-test',
        firstName: 'Notification',
        lastName: 'Test',
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    fixture.userIds.push(user.id);

    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
      select: { id: true },
    });
    fixture.sessionIds.push(session.id);

    return {
      userId: user.id,
      token: await jwt.signAsync({ sub: user.id, sid: session.id }),
    };
  }

  async function createNotification(userId: string) {
    if (!fixture) {
      throw new Error('Notifications e2e fixture was not initialized.');
    }

    const notification = await prisma.notification.create({
      data: { userId, type: 'ORDER_COMPLETED' },
      select: { id: true, readAt: true, type: true },
    });
    fixture.notificationIds.push(notification.id);
    return notification;
  }

  beforeAll(async () => {
    configureAuthTestDatabase();

    const testingModule = await Test.createTestingModule({
      imports: [NotificationsE2eModule],
    }).compile();

    app = testingModule.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    await app.init();

    const notificationTable = await prisma.$queryRaw<
      { tableName: string | null }[]
    >`SELECT to_regclass('public."Notification"')::text AS "tableName"`;
    if (!notificationTable[0]?.tableName) {
      throw new Error(
        'Notifications e2e tests require the existing migrations to be applied to the dedicated hulegeb_auth_test database.',
      );
    }
  });

  beforeEach(async () => {
    fixture = { userIds: [], sessionIds: [], notificationIds: [] };
  });

  afterEach(async () => {
    const currentFixture = fixture;
    fixture = undefined;
    if (!currentFixture) {
      return;
    }

    await prisma.$transaction([
      prisma.notification.deleteMany({
        where: { id: { in: currentFixture.notificationIds } },
      }),
      prisma.authSession.deleteMany({
        where: { id: { in: currentFixture.sessionIds } },
      }),
      prisma.user.deleteMany({
        where: { id: { in: currentFixture.userIds } },
      }),
    ]);
  });

  afterAll(async () => {
    if (typeof app !== 'undefined') {
      await app.close();
    }
  });

  it('returns only the authenticated user’s persisted notifications', async () => {
    const owner = await createSession();
    const otherUser = await createSession();
    const ownNotification = await createNotification(owner.userId);
    const otherNotification = await createNotification(otherUser.userId);

    const response = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({
        id: ownNotification.id,
        type: ownNotification.type,
        readAt: null,
      }),
    ]);
    expect(response.body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: otherNotification.id }),
      ]),
    );
  });

  it('returns 404 when a user tries to access another user’s notification', async () => {
    const owner = await createSession();
    const otherUser = await createSession();
    const otherNotification = await createNotification(otherUser.userId);

    await request(app.getHttpServer())
      .patch(`/notifications/${otherNotification.id}/read`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(404);

    const storedNotification = await prisma.notification.findUniqueOrThrow({
      where: { id: otherNotification.id },
      select: { readAt: true },
    });
    expect(storedNotification.readAt).toBeNull();
  });

  it('persists the read timestamp and preserves it on repeated requests', async () => {
    const owner = await createSession();
    const notification = await createNotification(owner.userId);

    const firstResponse = await request(app.getHttpServer())
      .patch(`/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const originalReadAt = firstResponse.body.readAt;
    expect(originalReadAt).toEqual(expect.any(String));

    const persistedAfterFirstRequest =
      await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
        select: { readAt: true },
      });
    expect(persistedAfterFirstRequest.readAt?.toISOString()).toBe(
      originalReadAt,
    );

    const secondResponse = await request(app.getHttpServer())
      .patch(`/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(secondResponse.body.readAt).toBe(originalReadAt);

    const persistedAfterSecondRequest =
      await prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
        select: { readAt: true },
      });
    expect(persistedAfterSecondRequest.readAt?.toISOString()).toBe(
      originalReadAt,
    );
  });

  it('rejects unauthenticated requests to notification endpoints', async () => {
    await request(app.getHttpServer()).get('/notifications').expect(401);
    await request(app.getHttpServer())
      .patch(`/notifications/${randomUUID()}/read`)
      .expect(401);
  });
});
