import {
  INestApplication,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuthService } from '../auth/auth.service.js';
import { AuthenticationGuard } from '../auth/authentication.guard.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { RolesGuard } from '../authorization/roles.guard.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

const notificationId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('NotificationsController HTTP endpoints', () => {
  let app: INestApplication<App>;
  const listNotifications = vi.fn();
  const markNotificationAsRead = vi.fn();

  beforeAll(async () => {
    const users = new Map([
      [
        'buyer-session',
        { id: 'buyer-id', roles: ['BUYER'], status: 'ACTIVE' },
      ],
      [
        'seller-session',
        { id: 'seller-id', roles: ['SELLER'], status: 'ACTIVE' },
      ],
    ]);
    const jwt = {
      verifyAsync: vi.fn(async (token: string) => {
        if (token === 'buyer-token') {
          return { sub: 'buyer-id', sid: 'buyer-session' };
        }
        if (token === 'seller-token') {
          return { sub: 'seller-id', sid: 'seller-session' };
        }
        throw new Error('Invalid test token.');
      }),
    };
    const auth = {
      loadAuthenticatedUser: vi.fn(
        async (_userId: string, sessionId: string) =>
          users.get(sessionId) ?? null,
      ),
    };

    @Module({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: { listNotifications, markNotificationAsRead },
        },
        { provide: JwtService, useValue: jwt },
        { provide: AuthService, useValue: auth },
        AuthorizationService,
        { provide: APP_GUARD, useClass: AuthenticationGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
    class NotificationsHttpTestModule {}

    const testingModule = await Test.createTestingModule({
      imports: [NotificationsHttpTestModule],
    }).compile();

    app = testingModule.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    listNotifications.mockResolvedValue([{ id: notificationId }]);
    markNotificationAsRead.mockResolvedValue({ id: notificationId });
    await app.init();
  });

  beforeEach(() => {
    listNotifications.mockClear();
    listNotifications.mockResolvedValue([{ id: notificationId }]);
    markNotificationAsRead.mockClear();
    markNotificationAsRead.mockResolvedValue({ id: notificationId });
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists a buyer's notifications with validated pagination", async () => {
    const response = await request(app.getHttpServer())
      .get('/notifications?page=2&limit=10')
      .set('Authorization', 'Bearer buyer-token')
      .expect(200);

    expect(response.body).toEqual([{ id: notificationId }]);
    expect(listNotifications).toHaveBeenCalledWith('buyer-id', {
      page: 2,
      limit: 10,
    });
  });

  it('allows sellers to use the same endpoint without role restrictions', async () => {
    await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', 'Bearer seller-token')
      .expect(200);

    expect(listNotifications).toHaveBeenCalledWith('seller-id', {
      page: 1,
      limit: 20,
    });
  });

  it('rejects pagination limits above the configured bound', async () => {
    await request(app.getHttpServer())
      .get('/notifications?limit=101')
      .set('Authorization', 'Bearer buyer-token')
      .expect(400);

    expect(listNotifications).not.toHaveBeenCalled();
  });

  it('marks the authenticated user’s notification as read', async () => {
    await request(app.getHttpServer())
      .patch(`/notifications/${notificationId}/read`)
      .set('Authorization', 'Bearer buyer-token')
      .expect(200);

    expect(markNotificationAsRead).toHaveBeenCalledWith(
      'buyer-id',
      notificationId,
    );
  });
});
