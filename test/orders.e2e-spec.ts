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
import { CatalogModule } from '../src/catalog/catalog.module.js';
import { CatalogService } from '../src/catalog/catalog.service.js';
import { CartModule } from '../src/cart/cart.module.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OrdersModule } from '../src/orders/orders.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { configureAuthTestDatabase } from './auth-test-database.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    AuthModule,
    AuthorizationModule,
    CatalogModule,
    OrdersModule,
    CartModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
class OrdersE2eModule {}

describe('Order and inventory integrity (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;
  let orders: OrdersService;
  let catalog: CatalogService;
  let fixture:
    | {
        buyerId?: string;
        otherBuyerId?: string;
        sellerUserId?: string;
        sellerProfileId?: string;
        categoryId?: string;
        productId?: string;
        idempotencyKey: string;
        token?: string;
        otherToken?: string;
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
    orders = app.get(OrdersService);
    catalog = app.get(CatalogService);
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
    const otherBuyer = await prisma.user.create({
      data: {
        email: `orders-e2e-other-buyer-${fixtureId}@example.test`,
        passwordHash: 'not-used-by-this-test',
        firstName: 'Other',
        lastName: 'Buyer',
        status: 'ACTIVE',
        userRoles: { create: { roleId: buyerRole.id } },
      },
      select: { id: true },
    });
    fixture.otherBuyerId = otherBuyer.id;
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
    const otherSession = await prisma.authSession.create({
      data: {
        userId: otherBuyer.id,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
      select: { id: true },
    });
    fixture.otherToken = await jwt.signAsync({
      sub: otherBuyer.id,
      sid: otherSession.id,
    });
    fixture.variantIds = product.variants.map(({ id }) => id);
  });

  afterEach(async () => {
    if (!fixture) {
      return;
    }
    const currentFixture = fixture;
    try {
      if (currentFixture.buyerId) {
        await prisma.orderStockReservation.deleteMany({
          where: {
            order: {
              buyerId: currentFixture.buyerId,
              idempotencyKey: { startsWith: currentFixture.idempotencyKey },
            },
          },
        });
        await prisma.order.deleteMany({
          where: {
            buyerId: currentFixture.buyerId,
            idempotencyKey: { startsWith: currentFixture.idempotencyKey },
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
        currentFixture.otherBuyerId,
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

  function authenticatedRequest(token?: string) {
    const accessToken = token ?? fixture?.token;
    if (!accessToken) {
      throw new Error('Order e2e fixture was not initialized.');
    }
    return {
      get: (path: string) =>
        request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${accessToken}`),
      post: (path: string) =>
        request(app.getHttpServer())
          .post(path)
          .set('Authorization', `Bearer ${accessToken}`),
      patch: (path: string) =>
        request(app.getHttpServer())
          .patch(path)
          .set('Authorization', `Bearer ${accessToken}`),
      delete: (path: string) =>
        request(app.getHttpServer())
          .delete(path)
          .set('Authorization', `Bearer ${accessToken}`),
    };
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

  async function createFixtureOrder(
    items: { variantId: string; quantity: number }[],
    key: string,
  ) {
    if (!fixture?.buyerId) {
      throw new Error('Order e2e fixture was not initialized.');
    }
    return orders.createOrder(
      fixture.buyerId,
      { items },
      `${fixture.idempotencyKey}-${key}`,
    );
  }

  async function setVariantStock(variantId: string, stockQuantity: number) {
    await prisma.productVariant.update({
      where: { id: variantId },
      data: { stockQuantity },
    });
  }

  it('keeps cart operations scoped to the authenticated buyer', async () => {
    const variantId = fixture?.variantIds?.[0];
    if (!variantId || !fixture?.otherToken) {
      throw new Error('Order e2e fixture was not initialized.');
    }

    const added = await authenticatedRequest()
      .post('/cart/items')
      .send({ variantId, quantity: 2 });
    expect(added.status).toBe(201);
    expect(added.body.items).toHaveLength(1);
    expect(added.body.items[0]).toMatchObject({
      variantId,
      quantity: 2,
      unitPrice: '12.50',
      lineTotal: '25.00',
      isAvailable: true,
    });
    expect(added.body.total).toBe('25.00');

    const otherCart = await authenticatedRequest(fixture.otherToken).get(
      '/cart',
    );
    expect(otherCart.status).toBe(200);
    expect(otherCart.body).toEqual({ items: [], total: '0.00' });
    await expect(
      authenticatedRequest(fixture.otherToken)
        .patch(`/cart/items/${variantId}`)
        .send({ quantity: 3 }),
    ).resolves.toMatchObject({ status: 404 });

    const otherRemoval = await authenticatedRequest(fixture.otherToken).delete(
      `/cart/items/${variantId}`,
    );
    expect(otherRemoval.status).toBe(200);
    expect(otherRemoval.body.items).toEqual([]);
    await expect(authenticatedRequest().get('/cart')).resolves.toMatchObject({
      body: { items: [expect.objectContaining({ variantId, quantity: 2 })] },
    });
  });

  it('adds, updates, and removes valid cart items', async () => {
    const variantId = fixture?.variantIds?.[0];
    if (!variantId) {
      throw new Error('Order e2e fixture was not initialized.');
    }
    const firstAdd = await authenticatedRequest()
      .post('/cart/items')
      .send({ variantId, quantity: 1 });
    expect(firstAdd.status).toBe(201);
    const secondAdd = await authenticatedRequest()
      .post('/cart/items')
      .send({ variantId, quantity: 2 });
    expect(secondAdd.body.items).toHaveLength(1);
    expect(secondAdd.body.items[0].quantity).toBe(3);

    const updated = await authenticatedRequest()
      .patch(`/cart/items/${variantId}`)
      .send({ quantity: 4 });
    expect(updated.status).toBe(200);
    expect(updated.body.items[0]).toMatchObject({
      quantity: 4,
      lineTotal: '50.00',
    });

    const removed = await authenticatedRequest().delete(
      `/cart/items/${variantId}`,
    );
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ items: [], total: '0.00' });
  });

  it('rejects invalid quantities, variants, and insufficient stock', async () => {
    const variantId = fixture?.variantIds?.[0];
    if (!variantId) {
      throw new Error('Order e2e fixture was not initialized.');
    }
    await expect(
      authenticatedRequest()
        .post('/cart/items')
        .send({ variantId, quantity: 0 }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      authenticatedRequest()
        .post('/cart/items')
        .send({ variantId, quantity: 11 }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      authenticatedRequest()
        .post('/cart/items')
        .send({ variantId, quantity: 1, unitPrice: 0 }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      authenticatedRequest()
        .post('/cart/items')
        .send({ variantId: randomUUID(), quantity: 1 }),
    ).resolves.toMatchObject({ status: 400 });

    await setVariantStock(variantId, 1);
    await expect(
      authenticatedRequest()
        .post('/cart/items')
        .send({ variantId, quantity: 2 }),
    ).resolves.toMatchObject({ status: 400 });
  });

  it('shows unavailable saved items and rejects them at checkout', async () => {
    const variantId = fixture?.variantIds?.[0];
    const productId = fixture?.productId;
    if (!variantId || !productId) {
      throw new Error('Order e2e fixture was not initialized.');
    }
    await authenticatedRequest()
      .post('/cart/items')
      .send({ variantId, quantity: 1 });
    await prisma.product.update({
      where: { id: productId },
      data: { status: 'UNAVAILABLE' },
    });

    const cart = await authenticatedRequest().get('/cart');
    expect(cart.body.items[0].isAvailable).toBe(false);
    const checkout = await authenticatedRequest()
      .post('/cart/checkout')
      .set('Idempotency-Key', `${fixture!.idempotencyKey}-unavailable`)
      .send();
    expect(checkout.status).toBe(400);
    expect((await authenticatedRequest().get('/cart')).body.items).toHaveLength(
      1,
    );
  });

  it('creates an order from server-priced cart items and clears checked-out items', async () => {
    const variantId = fixture?.variantIds?.[0];
    if (!variantId || !fixture) {
      throw new Error('Order e2e fixture was not initialized.');
    }
    await authenticatedRequest()
      .post('/cart/items')
      .send({ variantId, quantity: 2 });

    const idempotencyKey = `${fixture.idempotencyKey}-cart-checkout`;
    const checkout = await authenticatedRequest()
      .post('/cart/checkout')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        total: 0,
        items: [{ variantId, quantity: 99, unitPrice: 0 }],
      });
    expect(checkout.status).toBe(201);
    expect(Number(checkout.body.total)).toBe(25);
    expect(checkout.body.items).toHaveLength(1);
    expect(checkout.body.items[0]).toMatchObject({
      variantId,
      quantity: 2,
    });
    expect(
      await prisma.order.count({
        where: { buyerId: fixture.buyerId, idempotencyKey },
      }),
    ).toBe(1);
    expect((await authenticatedRequest().get('/cart')).body).toEqual({
      items: [],
      total: '0.00',
    });

    const retry = await authenticatedRequest()
      .post('/cart/checkout')
      .set('Idempotency-Key', idempotencyKey)
      .send();
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(checkout.body);
  });

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

  it('allows only one of two distinct orders to reserve the last unit', async () => {
    const variantId = fixture?.variantIds?.[0];
    if (!variantId) {
      throw new Error('Order e2e fixture was not initialized.');
    }
    await setVariantStock(variantId, 1);
    const first = await createFixtureOrder(
      [{ variantId, quantity: 1 }],
      'competing-one',
    );
    const second = await createFixtureOrder(
      [{ variantId, quantity: 1 }],
      'competing-two',
    );

    const results = await Promise.allSettled([
      orders.confirmAdminOrderStock(first.id),
      orders.confirmAdminOrderStock(second.id),
    ]);
    const inventory = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stockQuantity: true },
    });
    const reservations = await prisma.orderStockReservation.findMany({
      where: { variantId, releasedAt: null },
      select: { orderId: true, quantity: true },
    });

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    expect(inventory.stockQuantity).toBe(0);
    expect(reservations).toHaveLength(1);
    expect(reservations[0].quantity).toBe(1);
  });

  it('rolls back earlier variant decrements when a multi-item reservation fails', async () => {
    const variantIds = fixture?.variantIds;
    if (!variantIds || variantIds.length < 2) {
      throw new Error('Order e2e fixture needs two variants.');
    }
    const orderedIds = [...variantIds].sort();
    const order = await createFixtureOrder(
      orderedIds.map((variantId) => ({ variantId, quantity: 1 })),
      'multi-item-rollback',
    );

    await setVariantStock(orderedIds[0], 1);
    await setVariantStock(orderedIds[1], 0);

    await expect(orders.confirmAdminOrderStock(order.id)).rejects.toThrow();

    const variants = await prisma.productVariant.findMany({
      where: { id: { in: orderedIds } },
      select: { id: true, stockQuantity: true },
    });
    expect(
      variants.sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual([
      { id: orderedIds[0], stockQuantity: 1 },
      { id: orderedIds[1], stockQuantity: 0 },
    ]);
    await expect(
      prisma.orderStockReservation.count({ where: { orderId: order.id } }),
    ).resolves.toBe(0);
  });

  it('restores stock once when cancellation calls race', async () => {
    const variantId = fixture?.variantIds?.[0];
    if (!variantId) {
      throw new Error('Order e2e fixture was not initialized.');
    }
    await setVariantStock(variantId, 5);
    const order = await createFixtureOrder(
      [{ variantId, quantity: 2 }],
      'concurrent-cancel',
    );
    await orders.confirmAdminOrderStock(order.id);
    expect(
      await prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { stockQuantity: true },
      }),
    ).toEqual({ stockQuantity: 3 });

    const cancellations = await Promise.all([
      orders.updateAdminOrderStatus(order.id, 'CANCELLED'),
      orders.updateAdminOrderStatus(order.id, 'CANCELLED'),
    ]);

    expect(cancellations.map(({ status }) => status)).toEqual([
      'CANCELLED',
      'CANCELLED',
    ]);
    await expect(
      prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { stockQuantity: true },
      }),
    ).resolves.toEqual({ stockQuantity: 5 });
    await expect(
      prisma.orderStockReservation.count({
        where: { orderId: order.id, releasedAt: null },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.notification.count({
        where: { resourceId: order.id, type: 'ORDER_CANCELLED' },
      }),
    ).resolves.toBe(1);
  });

  it('keeps reserved stock consistent when seller stock editing races with confirmation', async () => {
    const variantId = fixture?.variantIds?.[0];
    const productId = fixture?.productId;
    const sellerUserId = fixture?.sellerUserId;
    if (!variantId || !productId || !sellerUserId) {
      throw new Error('Order e2e fixture was not initialized.');
    }
    await setVariantStock(variantId, 5);
    const order = await createFixtureOrder(
      [{ variantId, quantity: 2 }],
      'seller-stock-race',
    );

    const outcomes = await Promise.allSettled([
      orders.confirmAdminOrderStock(order.id),
      catalog.updateVariant(
        {
          id: sellerUserId,
          roles: ['SELLER'],
          status: 'ACTIVE',
          sellerStatus: 'APPROVED',
        },
        productId,
        variantId,
        { stockQuantity: 20 },
      ),
    ]);

    const inventory = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stockQuantity: true },
    });
    const activeReservations = await prisma.orderStockReservation.findMany({
      where: { orderId: order.id, releasedAt: null },
      select: { quantity: true },
    });

    expect(outcomes[0].status).toBe('fulfilled');
    expect(activeReservations).toEqual([{ quantity: 2 }]);
    expect([3, 18]).toContain(inventory.stockQuantity);
    if (outcomes[1].status === 'fulfilled') {
      expect(inventory.stockQuantity).toBe(18);
    } else {
      expect(outcomes[1].reason).toMatchObject({
        status: 409,
      });
      expect(inventory.stockQuantity).toBe(3);
    }
  });

  it('retains the stock decrement and active reservation after completion', async () => {
    const variantId = fixture?.variantIds?.[0];
    if (!variantId) {
      throw new Error('Order e2e fixture was not initialized.');
    }
    await setVariantStock(variantId, 5);
    const order = await createFixtureOrder(
      [{ variantId, quantity: 2 }],
      'completion-stock-retention',
    );
    await orders.confirmAdminOrderStock(order.id);
    await orders.selectBuyerPaymentOption(fixture!.buyerId!, order.id, 'FULL');

    await expect(
      orders.updateAdminOrderStatus(order.id, 'COMPLETED'),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    await expect(
      prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { stockQuantity: true },
      }),
    ).resolves.toEqual({ stockQuantity: 3 });
    await expect(
      prisma.orderStockReservation.count({
        where: { orderId: order.id, releasedAt: null, quantity: 2 },
      }),
    ).resolves.toBe(1);
  });
});
