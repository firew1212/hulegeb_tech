import {
  INestApplication,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { AuthenticationGuard } from '../src/auth/authentication.guard.js';
import { RolesGuard } from '../src/authorization/roles.guard.js';
import { AuthorizationModule } from '../src/authorization/authorization.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SellersModule } from '../src/sellers/sellers.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    AuthModule,
    AuthorizationModule,
    SellersModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
class SellerApplicationsE2eModule {}

describe('Seller application HTTP flow (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;
  const fixtureUserIds: string[] = [];

  async function createSession(roleCode: 'BUYER' | 'ADMIN') {
    const role = await prisma.role.upsert({
      where: { code: roleCode },
      update: {},
      create: { code: roleCode },
      select: { id: true },
    });
    const user = await prisma.user.create({
      data: {
        email: `seller-application-${roleCode.toLowerCase()}-${randomUUID()}@example.test`,
        passwordHash: 'not-used-by-this-test',
        firstName: 'Test',
        lastName: 'Buyer',
        status: 'ACTIVE',
        userRoles: { create: { roleId: role.id } },
      },
      select: { id: true },
    });
    fixtureUserIds.push(user.id);
    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
      select: { id: true },
    });

    return {
      userId: user.id,
      token: await jwt.signAsync({ sub: user.id, sid: session.id }),
    };
  }

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      imports: [SellerApplicationsE2eModule],
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
  });

  afterAll(async () => {
    if (fixtureUserIds.length > 0) {
      await prisma.sellerProfile.deleteMany({
        where: { userId: { in: fixtureUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: fixtureUserIds } },
      });
    }
    if (typeof app !== 'undefined') {
      await app.close();
    }
  });

  it('requires a buyer session, validates input, and creates one pending application per account', async () => {
    const unauthenticated = await request(app.getHttpServer())
      .post('/sellers/applications')
      .send({
        sellerType: 'INDIVIDUAL',
        displayName: 'My Shop',
      })
      .expect(401);
    expect(unauthenticated.body).not.toHaveProperty('userId');

    const individualUser = await createSession('BUYER');
    const businessUser = await createSession('BUYER');
    const admin = await createSession('ADMIN');
    const individualToken = individualUser.token;
    const businessToken = businessUser.token;

    await request(app.getHttpServer())
      .get('/sellers/applications/pending')
      .expect(401);
    await request(app.getHttpServer())
      .get('/sellers/applications/pending')
      .set('Authorization', `Bearer ${individualToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/sellers/applications/not-a-uuid/approve')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(400);

    await request(app.getHttpServer())
      .post('/sellers/applications')
      .set('Authorization', `Bearer ${individualToken}`)
      .send({ sellerType: 'OTHER', displayName: 'My Shop' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/sellers/applications')
      .set('Authorization', `Bearer ${individualToken}`)
      .send({ sellerType: 'INDIVIDUAL', displayName: '   ' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/sellers/applications')
      .set('Authorization', `Bearer ${individualToken}`)
      .send({
        sellerType: 'INDIVIDUAL',
        displayName: 'My Shop',
        userId: fixtureUserIds[1],
      })
      .expect(400);

    const individual = await request(app.getHttpServer())
      .post('/sellers/applications')
      .set('Authorization', `Bearer ${individualToken}`)
      .send({
        sellerType: 'INDIVIDUAL',
        displayName: ' Individual Shop ',
      })
      .expect(201);
    const business = await request(app.getHttpServer())
      .post('/sellers/applications')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({
        sellerType: 'BUSINESS',
        displayName: 'Business Shop',
        legalName: 'Business Legal Name',
      })
      .expect(201);

    expect(individual.body).toMatchObject({
      sellerType: 'INDIVIDUAL',
      displayName: 'Individual Shop',
      legalName: null,
      status: 'PENDING_APPROVAL',
    });
    expect(business.body).toMatchObject({
      sellerType: 'BUSINESS',
      displayName: 'Business Shop',
      legalName: 'Business Legal Name',
      status: 'PENDING_APPROVAL',
    });
    expect(individual.body).not.toHaveProperty('userId');
    expect(business.body).not.toHaveProperty('userId');

    const storedUsers = await prisma.user.findMany({
      where: { id: { in: [individualUser.userId, businessUser.userId] } },
      include: {
        userRoles: { include: { role: { select: { code: true } } } },
        sellerProfile: true,
      },
    });
    expect(storedUsers).toHaveLength(2);
    expect(
      storedUsers.map((user) => user.sellerProfile?.status),
    ).toEqual(['PENDING_APPROVAL', 'PENDING_APPROVAL']);
    expect(
      storedUsers.every(
        (user) =>
          user.userRoles.length === 1 &&
          user.userRoles[0].role.code === 'BUYER',
      ),
    ).toBe(true);

    const pendingApplications = await request(app.getHttpServer())
      .get('/sellers/applications/pending')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    const pendingIds = pendingApplications.body.map(
      (application: { id: string }) => application.id,
    );
    expect(pendingIds).toContain(individual.body.id);
    expect(pendingIds).toContain(business.body.id);

    await request(app.getHttpServer())
      .post(`/sellers/applications/${individual.body.id}/approve`)
      .set('Authorization', `Bearer ${individualToken}`)
      .expect(403);
    const approved = await request(app.getHttpServer())
      .post(`/sellers/applications/${individual.body.id}/approve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);
    expect(approved.body).toMatchObject({
      id: individual.body.id,
      userId: individualUser.userId,
      status: 'APPROVED',
    });
    expect(approved.body.approvedAt).toBeTruthy();

    const [approvedOwner, unrelatedApplicant] = await prisma.user.findMany({
      where: { id: { in: [individualUser.userId, businessUser.userId] } },
      include: { userRoles: { include: { role: { select: { code: true } } } } },
    });
    expect(
      approvedOwner.userRoles.map(({ role }) => role.code),
    ).toContain('SELLER');
    expect(
      unrelatedApplicant.userRoles.map(({ role }) => role.code),
    ).not.toContain('SELLER');

    await request(app.getHttpServer())
      .post(`/sellers/applications/${business.body.id}/reject`)
      .set('Authorization', `Bearer ${businessToken}`)
      .expect(403);
    const rejected = await request(app.getHttpServer())
      .post(`/sellers/applications/${business.body.id}/reject`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);
    expect(rejected.body).toMatchObject({
      id: business.body.id,
      userId: businessUser.userId,
      status: 'REJECTED',
    });

    await request(app.getHttpServer())
      .post(`/sellers/applications/${individual.body.id}/approve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/sellers/applications/${business.body.id}/reject`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/sellers/applications/${randomUUID()}/approve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(404);
    const remainingPending = await request(app.getHttpServer())
      .get('/sellers/applications/pending')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    const remainingPendingIds = remainingPending.body.map(
      (application: { id: string }) => application.id,
    );
    expect(remainingPendingIds).not.toContain(individual.body.id);
    expect(remainingPendingIds).not.toContain(business.body.id);

    await request(app.getHttpServer())
      .post('/sellers/applications')
      .set('Authorization', `Bearer ${individualToken}`)
      .send({
        sellerType: 'INDIVIDUAL',
        displayName: 'Second Shop',
      })
      .expect(409);
  });
});
