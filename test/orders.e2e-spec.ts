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
import { OrdersModule } from '../src/orders/orders.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { configureAuthTestDatabase } from './auth-test-database.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    AuthModule,
    AuthorizationModule,
    OrdersModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
class OrdersE2eModule {}

describe('Order creation concurrency (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;
  let fixture:
    | {
        buyerId?: string;
        sellerUserId?: string;
        sellerProfileId?: string;
        categoryId?: string;
        productId?: string;
        idempotencyKey: string;
        token?: string;
        variantIds?: string[];
      }
    | undefined;

  beforeAll(async () => {
    configureAuthTestDatabase();

    const testingModule = await Test.createTestingModule({
      imports: [OrdersE2eModule],
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
    const orderTable = await prisma.$queryRaw<
      { tableName: string | null }[]
    >`SELECT to_regclass('public."Order"')::text AS "tableName"`;
    if (!orderTable[0]?.tableName) {
      throw new Error(
        'Order e2e tests require the existing migrations to be applied to the dedicated hulegeb_auth_test database.',
      );
    }
  });

  beforeEach(async () => {
    const fixtureId = randomUUID();
    const idempotencyKey = `orders-e2e-${fixtureId}`;
    fixture = { idempotencyKey };
    const buyerRole = await prisma.role.upsert({
      where: { code: 'BUYER' },
      update: {},
      create: { code: 'BUYER' },
      select: { id: true },
    });
    const buyer = await prisma.user.create({
      data: {
        email: `orders-e2e-buyer-${fixtureId}@example.test`,
        passwordHash: 'not-used-by-this-test',
        firstName: 'Order',
        lastName: 'Buyer',
        status: 'ACTIVE',
        userRoles: { create: { roleId: buyerRole.id } },
      },
      select: { id: true },
    });
    fixture.buyerId = buyer.id;
    const sellerUser = await prisma.user.create({
      data: {
        email: `orders-e2e-seller-${fixtureId}@example.test`,
        passwordHash: 'not-used-by-this-test',
        firstName: 'Order',
        lastName: 'Seller',
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    fixture.sellerUserId = sellerUser.id;
    const sellerProfile = await prisma.sellerProfile.create({
      data: {
        userId: sellerUser.id,
        sellerType: 'INDIVIDUAL',
        displayName: 'Order Test Seller',
        status: 'APPROVED',
        approvedAt: new Date(),
      },
      select: { id: true },
    });
    fixture.sellerProfileId = sellerProfile.id;
    const category = await prisma.category.create({
      data: {
        slug: `orders-e2e-${fixtureId}`,
        nameEn: 'Order Test Category',
        nameAm: 'የትዕዛዝ ሙከራ',
      },
      select: { id: true },
    });
    fixture.categoryId = category.id;
    const product = await prisma.product.create({
      data: {
        sellerId: sellerProfile.id,
        categoryId: category.id,
        slug: `orders-e2e-${fixtureId}`,
        titleEn: 'Order Test Product',
        titleAm: 'የትዕዛዝ ሙከራ ምርት',
        status: 'APPROVED',
        variants: {
          create: [
            {
              sku: `orders-e2e-one-${fixtureId}`,
              name: 'Variant One',
              price: '12.50',
              stockQuantity: 10,
            },
            {
              sku: `orders-e2e-two-${fixtureId}`,
              name: 'Variant Two',
              price: '15.00',
              stockQuantity: 10,
            },
          ],
        },
      },
      select: {
        id: true,
        variants: { select: { id: true }, orderBy: { sku: 'asc' } },
      },
    });
    fixture.productId = product.id;
    const session = await prisma.authSession.create({
      data: {
        userId: buyer.id,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
      select: { id: true },
    });

    fixture.token = await jwt.signAsync({ sub: buyer.id, sid: session.id });
    fixture.variantIds = product.variants.map(({ id }) => id);
  });

  afterEach(async () => {
    if (!fixture) {
      return;
    }
    const currentFixture = fixture;
    try {
      if (currentFixture.buyerId) {
        await prisma.order.deleteMany({
          where: {
            buyerId: currentFixture.buyerId,
            idempotencyKey: currentFixture.idempotencyKey,
          },
        });
      }
    } finally {
      if (currentFixture.productId) {
        await prisma.product.deleteMany({
          where: { id: currentFixture.productId },
        });
      }
      if (currentFixture.categoryId) {
        await prisma.category.deleteMany({
          where: { id: currentFixture.categoryId },
        });
      }
      if (currentFixture.sellerProfileId) {
        await prisma.sellerProfile.deleteMany({
          where: { id: currentFixture.sellerProfileId },
        });
      }
      const userIds = [
        currentFixture.buyerId,
        currentFixture.sellerUserId,
      ].filter((userId): userId is string => userId !== undefined);
      if (userIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      fixture = undefined;
    }
  });

  afterAll(async () => {
    if (typeof app !== 'undefined') {
      await app.close();
    }
  });

  function postOrder(variantId: string, idempotencyKey: string) {
    if (!fixture?.token) {
      throw new Error('Order e2e fixture was not initialized.');
    }
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${fixture.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ items: [{ variantId, quantity: 1 }] });
  }

  async function expectOneOrderForKey(idempotencyKey: string) {
    if (!fixture?.buyerId) {
      throw new Error('Order e2e fixture was not initialized.');
    }
    const count = await prisma.order.count({
      where: {
        buyerId: fixture.buyerId,
        idempotencyKey,
      },
    });
    expect(count).toBe(1);
  }

  it('returns one consistent order for concurrent retries with the same payload', async () => {
    if (!fixture?.variantIds) {
      throw new Error('Order e2e fixture was not initialized.');
    }
    const { idempotencyKey, variantIds } = fixture;
    const [first, second] = await Promise.all([
      postOrder(variantIds[0], idempotencyKey),
      postOrder(variantIds[0], idempotencyKey),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body).toEqual(second.body);
    expect(first.body).not.toHaveProperty('buyerId');
    expect(first.body).not.toHaveProperty('requestHash');
    await expectOneOrderForKey(idempotencyKey);
  });

  it('rejects a conflicting concurrent payload and stores only the winning order', async () => {
    if (!fixture?.variantIds) {
      throw new Error('Order e2e fixture was not initialized.');
    }
    const { idempotencyKey, variantIds } = fixture;
    const responses = await Promise.all([
      postOrder(variantIds[0], idempotencyKey),
      postOrder(variantIds[1], idempotencyKey),
    ]);

    expect(
      responses.map(({ status }) => status).sort((left, right) => left - right),
    ).toEqual([201, 409]);
    await expectOneOrderForKey(idempotencyKey);
  });
});
