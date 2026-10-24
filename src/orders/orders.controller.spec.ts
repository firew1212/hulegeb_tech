import {
  BadRequestException,
  ConflictException,
  INestApplication,
  Module,
  NotFoundException,
  ServiceUnavailableException,
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
import { OrdersController } from './orders.controller.js';
import { CreateOrderDto } from './orders.dto.js';
import { OfficialBuyerContactService } from './official-buyer-contact.service.js';
import { OrdersService } from './orders.service.js';

const safeOrder = {
  id: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
  status: 'PENDING',
  paymentOption: null,
  paymentAmount: null,
  currency: 'ETB',
  total: '6.80',
  createdAt: '2026-10-21T12:00:00.000Z',
  updatedAt: '2026-10-21T12:00:00.000Z',
  items: [
    {
      id: 'item-id',
      productId: 'product-id',
      variantId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      productNameEn: 'Linen shirt',
      productNameAm: 'የበፍታ ሸሚዝ',
      variantName: 'Large / Blue',
      quantity: 2,
      unitPrice: '3.40',
      lineTotal: '6.80',
    },
  ],
};

describe('OrdersController HTTP endpoint', () => {
  let app: INestApplication<App>;
  const createOrder = vi.fn();
  const listBuyerOrders = vi.fn();
  const getBuyerOrder = vi.fn();
  const selectBuyerPaymentOption = vi.fn();
  const listAdminOrders = vi.fn();
  const getAdminOrder = vi.fn();
  const confirmAdminOrderStock = vi.fn();
  const updateAdminOrderStatus = vi.fn();
  const getOfficialBuyerContact = vi.fn();

  beforeAll(async () => {
    const users = new Map([
      [
        'buyer-session',
        {
          id: 'buyer-id',
          roles: ['BUYER'],
          status: 'ACTIVE',
        },
      ],
      [
        'admin-session',
        {
          id: 'admin-id',
          roles: ['ADMIN'],
          status: 'ACTIVE',
        },
      ],
      [
        'seller-session',
        {
          id: 'seller-id',
          roles: ['SELLER'],
          status: 'ACTIVE',
        },
      ],
      [
        'inactive-buyer-session',
        {
          id: 'inactive-buyer-id',
          roles: ['BUYER'],
          status: 'PENDING_VERIFICATION',
        },
      ],
    ]);
    const jwt = {
      verifyAsync: vi.fn(async (token: string) => {
        if (token === 'buyer-token') {
          return { sub: 'buyer-id', sid: 'buyer-session' };
        }
        if (token === 'admin-token') {
          return { sub: 'admin-id', sid: 'admin-session' };
        }
        if (token === 'seller-token') {
          return { sub: 'seller-id', sid: 'seller-session' };
        }
        if (token === 'inactive-buyer-token') {
          return {
            sub: 'inactive-buyer-id',
            sid: 'inactive-buyer-session',
          };
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
      controllers: [OrdersController],
      providers: [
        {
          provide: OrdersService,
          useValue: {
            createOrder,
            listBuyerOrders,
            getBuyerOrder,
            selectBuyerPaymentOption,
            listAdminOrders,
            getAdminOrder,
            confirmAdminOrderStock,
            updateAdminOrderStatus,
          },
        },
        {
          provide: OfficialBuyerContactService,
          useValue: { getContact: getOfficialBuyerContact },
        },
        { provide: JwtService, useValue: jwt },
        { provide: AuthService, useValue: auth },
        AuthorizationService,
        { provide: APP_GUARD, useClass: AuthenticationGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
    class OrdersHttpTestModule {}

    const testingModule = await Test.createTestingModule({
      imports: [OrdersHttpTestModule],
    }).compile();

    app = testingModule.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    createOrder.mockResolvedValue(safeOrder);
    listBuyerOrders.mockResolvedValue([safeOrder]);
    getBuyerOrder.mockResolvedValue(safeOrder);
    selectBuyerPaymentOption.mockResolvedValue({
      ...safeOrder,
      paymentOption: 'DEPOSIT',
      paymentAmount: '3.40',
    });
    listAdminOrders.mockResolvedValue([safeOrder]);
    getAdminOrder.mockResolvedValue(safeOrder);
    confirmAdminOrderStock.mockResolvedValue(safeOrder);
    updateAdminOrderStatus.mockResolvedValue({
      ...safeOrder,
      status: 'COMPLETED',
    });
    getOfficialBuyerContact.mockReturnValue({
      phone: '+12025550123',
      telegram: '@example_support',
    });
    await app.init();
  });

  beforeEach(() => {
    createOrder.mockClear();
    createOrder.mockResolvedValue(safeOrder);
    listBuyerOrders.mockClear();
    listBuyerOrders.mockResolvedValue([safeOrder]);
    getBuyerOrder.mockClear();
    getBuyerOrder.mockResolvedValue(safeOrder);
    selectBuyerPaymentOption.mockClear();
    selectBuyerPaymentOption.mockResolvedValue({
      ...safeOrder,
      paymentOption: 'DEPOSIT',
      paymentAmount: '3.40',
    });
    listAdminOrders.mockClear();
    listAdminOrders.mockResolvedValue([safeOrder]);
    getAdminOrder.mockClear();
    getAdminOrder.mockResolvedValue(safeOrder);
    confirmAdminOrderStock.mockClear();
    confirmAdminOrderStock.mockResolvedValue(safeOrder);
    updateAdminOrderStatus.mockClear();
    updateAdminOrderStatus.mockResolvedValue({
      ...safeOrder,
      status: 'COMPLETED',
    });
    getOfficialBuyerContact.mockClear();
    getOfficialBuyerContact.mockReturnValue({
      phone: '+12025550123',
      telegram: '@example_support',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns only official contact values to an authenticated buyer', async () => {
    getBuyerOrder.mockResolvedValueOnce({
      ...safeOrder,
      paymentOption: 'FULL',
      paymentAmount: safeOrder.total,
    });
    const response = await request(app.getHttpServer())
      .get(`/orders/contact?orderId=${safeOrder.id}`)
      .set('Authorization', 'Bearer buyer-token')
      .expect(200);

    expect(getBuyerOrder).toHaveBeenCalledWith('buyer-id', safeOrder.id);
    expect(getOfficialBuyerContact).toHaveBeenCalledOnce();
    expect(response.body).toEqual({
      phone: '+12025550123',
      telegram: '@example_support',
    });
    expect(Object.keys(response.body).sort()).toEqual(['phone', 'telegram']);
  });

  it.each(['seller-token', 'admin-token'])(
    'denies official buyer contact access to non-buyers (%s)',
    async (token) => {
      await request(app.getHttpServer())
        .get('/orders/contact')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(getOfficialBuyerContact).not.toHaveBeenCalled();
    },
  );

  it('denies unauthenticated access to official buyer contacts', async () => {
    await request(app.getHttpServer()).get('/orders/contact').expect(401);

    expect(getOfficialBuyerContact).not.toHaveBeenCalled();
  });

  it('returns a safe unavailable response when official contacts are missing', async () => {
    getBuyerOrder.mockResolvedValueOnce({
      ...safeOrder,
      paymentOption: 'DEPOSIT',
    });
    getOfficialBuyerContact.mockImplementationOnce(() => {
      throw new ServiceUnavailableException(
        'Official buyer contact information is not configured.',
      );
    });

    const response = await request(app.getHttpServer())
      .get(`/orders/contact?orderId=${safeOrder.id}`)
      .set('Authorization', 'Bearer buyer-token')
      .expect(503);

    expect(response.body.message).toBe(
      'Official buyer contact information is not configured.',
    );
    expect(response.body).not.toHaveProperty('stack');
    expect(response.body.message).not.toContain('HULEGEB_OFFICIAL');
  });

  it('returns a safe unavailable response when official contacts are invalid', async () => {
    getBuyerOrder.mockResolvedValueOnce({
      ...safeOrder,
      paymentOption: 'DEPOSIT',
    });
    getOfficialBuyerContact.mockImplementationOnce(() => {
      throw new ServiceUnavailableException(
        'Official buyer contact information is not configured.',
      );
    });

    const response = await request(app.getHttpServer())
      .get(`/orders/contact?orderId=${safeOrder.id}`)
      .set('Authorization', 'Bearer buyer-token')
      .expect(503);

    expect(response.body.message).toBe(
      'Official buyer contact information is not configured.',
    );
    expect(response.body).not.toHaveProperty('stack');
    expect(response.body.message).not.toContain('HULEGEB_OFFICIAL');
  });

  it('allows an admin to list orders with safe fields', async () => {
    const response = await request(app.getHttpServer())
      .get('/orders/admin')
      .set('Authorization', 'Bearer admin-token')
      .expect(200);

    expect(listAdminOrders).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(response.body).toEqual([safeOrder]);
    expect(response.body[0]).not.toHaveProperty('buyerId');
    expect(response.body[0]).not.toHaveProperty('requestHash');
    expect(response.body[0]).not.toHaveProperty('idempotencyKey');
  });

  it('allows an admin to view one order with safe fields', async () => {
    const response = await request(app.getHttpServer())
      .get(`/orders/admin/${safeOrder.id}`)
      .set('Authorization', 'Bearer admin-token')
      .expect(200);

    expect(getAdminOrder).toHaveBeenCalledWith(safeOrder.id);
    expect(response.body).toEqual(safeOrder);
    expect(response.body).not.toHaveProperty('buyerId');
    expect(response.body).not.toHaveProperty('requestHash');
    expect(response.body).not.toHaveProperty('idempotencyKey');
  });

  it('allows an admin to confirm stock without changing the order status', async () => {
    const response = await request(app.getHttpServer())
      .post(`/orders/admin/${safeOrder.id}/confirm-stock`)
      .set('Authorization', 'Bearer admin-token')
      .expect(201);

    expect(confirmAdminOrderStock).toHaveBeenCalledWith(safeOrder.id);
    expect(response.body.status).toBe('PENDING');
  });

  it('does not allow the status endpoint to expose CONFIRMED', async () => {
    await request(app.getHttpServer())
      .patch(`/orders/admin/${safeOrder.id}/status`)
      .set('Authorization', 'Bearer admin-token')
      .send({ status: 'CONFIRMED' })
      .expect(400);

    expect(updateAdminOrderStatus).not.toHaveBeenCalled();
  });

  it('allows an admin to manually complete an order', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/orders/admin/${safeOrder.id}/status`)
      .set('Authorization', '******')
      .send({ status: 'COMPLETED' })
      .set('Authorization', 'Bearer admin-token')
      .expect(200);

    expect(updateAdminOrderStatus).toHaveBeenCalledWith(
      safeOrder.id,
      'COMPLETED',
    );
    expect(response.body.status).toBe('COMPLETED');
  });

  it.each([
    ['buyer-token', 'GET', '/orders/admin'],
    ['seller-token', 'GET', `/orders/admin/${safeOrder.id}`],
    ['buyer-token', 'POST', `/orders/admin/${safeOrder.id}/confirm-stock`],
    ['seller-token', 'POST', `/orders/admin/${safeOrder.id}/confirm-stock`],
    ['buyer-token', 'PATCH', `/orders/admin/${safeOrder.id}/status`],
  ])(
    'denies non-admin access to admin order routes (%s %s %s)',
    async (token, method, path) => {
      const agent = request(app.getHttpServer());
      const call = (
        method === 'GET'
          ? agent.get(path)
          : method === 'POST'
            ? agent.post(path)
            : agent.patch(path)
      ).set('Authorization', `Bearer ${token}`);
      if (method === 'PATCH') {
        call.send({ status: 'CONFIRMED' });
      }

      await call.expect(403);
      expect(listAdminOrders).not.toHaveBeenCalled();
      expect(getAdminOrder).not.toHaveBeenCalled();
      expect(confirmAdminOrderStock).not.toHaveBeenCalled();
      expect(updateAdminOrderStatus).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['GET', '/orders/admin/not-a-uuid'],
    ['POST', '/orders/admin/not-a-uuid/confirm-stock'],
    ['PATCH', '/orders/admin/not-a-uuid/status'],
  ])('rejects invalid admin order IDs (%s %s)', async (method, path) => {
    const agent = request(app.getHttpServer());
    const call = (
      method === 'GET'
        ? agent.get(path)
        : method === 'POST'
          ? agent.post(path)
          : agent.patch(path)
    ).set('Authorization', 'Bearer admin-token');
    if (method === 'PATCH') {
      call.send({ status: 'CONFIRMED' });
    }

    await call.expect(400);
    expect(getAdminOrder).not.toHaveBeenCalled();
    expect(confirmAdminOrderStock).not.toHaveBeenCalled();
    expect(updateAdminOrderStatus).not.toHaveBeenCalled();
  });

  it('rejects unsupported admin order statuses', async () => {
    await request(app.getHttpServer())
      .patch(`/orders/admin/${safeOrder.id}/status`)
      .set('Authorization', 'Bearer admin-token')
      .send({ status: 'SHIPPED' })
      .expect(400);

    expect(updateAdminOrderStatus).not.toHaveBeenCalled();
  });

  it('denies unauthenticated stock confirmation', async () => {
    await request(app.getHttpServer())
      .post(`/orders/admin/${safeOrder.id}/confirm-stock`)
      .expect(401);

    expect(confirmAdminOrderStock).not.toHaveBeenCalled();
  });

  it('returns not found for a missing admin order', async () => {
    getAdminOrder.mockRejectedValueOnce(
      new NotFoundException('Order was not found.'),
    );

    await request(app.getHttpServer())
      .get(`/orders/admin/${safeOrder.id}`)
      .set('Authorization', 'Bearer admin-token')
      .expect(404);
  });

  it('lists only the authenticated buyer orders with bounded pagination defaults', async () => {
    const response = await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', 'Bearer buyer-token')
      .expect(200);

    expect(listBuyerOrders).toHaveBeenCalledWith('buyer-id', {
      page: 1,
      limit: 20,
    });
    expect(response.body).toEqual([safeOrder]);
    expect(response.body[0]).not.toHaveProperty('buyerId');
    expect(response.body[0]).not.toHaveProperty('requestHash');
    expect(response.body[0]).not.toHaveProperty('idempotencyKey');
    expect(response.body[0].items[0]).not.toHaveProperty('seller');
    expect(response.body[0].items[0]).not.toHaveProperty('phone');
  });

  it('passes explicit pagination to the buyer order list', async () => {
    await request(app.getHttpServer())
      .get('/orders?page=2&limit=5')
      .set('Authorization', 'Bearer buyer-token')
      .expect(200);

    expect(listBuyerOrders).toHaveBeenCalledWith('buyer-id', {
      page: 2,
      limit: 5,
    });
  });

  it('returns an empty list when the buyer has no orders', async () => {
    listBuyerOrders.mockResolvedValueOnce([]);

    const response = await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', 'Bearer buyer-token')
      .expect(200);

    expect(response.body).toEqual([]);
    expect(listBuyerOrders).toHaveBeenCalledWith('buyer-id', {
      page: 1,
      limit: 20,
    });
  });

  it('rejects invalid pagination values', async () => {
    await request(app.getHttpServer())
      .get('/orders?page=0&limit=101')
      .set('Authorization', 'Bearer buyer-token')
      .expect(400);

    expect(listBuyerOrders).not.toHaveBeenCalled();
  });

  it('returns one buyer order with only safe fields', async () => {
    const response = await request(app.getHttpServer())
      .get(`/orders/${safeOrder.id}`)
      .set('Authorization', 'Bearer buyer-token')
      .expect(200);

    expect(getBuyerOrder).toHaveBeenCalledWith('buyer-id', safeOrder.id);
    expect(response.body).toEqual(safeOrder);
    expect(response.body).not.toHaveProperty('buyerId');
    expect(response.body).not.toHaveProperty('requestHash');
    expect(response.body).not.toHaveProperty('idempotencyKey');
    expect(response.body.items[0]).not.toHaveProperty('seller');
    expect(response.body.items[0]).not.toHaveProperty('phone');
  });

  it('lets the authenticated buyer select a payment option and see the amount due', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/orders/${safeOrder.id}/payment`)
      .set('Authorization', '******')
      .send({ paymentOption: 'DEPOSIT' })
      .set('Authorization', 'Bearer buyer-token')
      .expect(200);

    expect(selectBuyerPaymentOption).toHaveBeenCalledWith(
      'buyer-id',
      safeOrder.id,
      'DEPOSIT',
    );
    expect(response.body).toMatchObject({
      total: '6.80',
      paymentOption: 'DEPOSIT',
      paymentAmount: '3.40',
    });
  });

  it('rejects payment options outside DEPOSIT and FULL', async () => {
    await request(app.getHttpServer())
      .patch(`/orders/${safeOrder.id}/payment`)
      .set('Authorization', '******')
      .send({ paymentOption: 'CREDIT' })
      .set('Authorization', 'Bearer buyer-token')
      .expect(400);

    expect(selectBuyerPaymentOption).not.toHaveBeenCalled();
  });

  it.each(['admin-token', 'seller-token'])(
    'denies payment selection to non-buyers (%s)',
    async (token) => {
      await request(app.getHttpServer())
        .patch(`/orders/${safeOrder.id}/payment`)
        .set('Authorization', `Bearer ${token}`)
        .send({ paymentOption: 'FULL' })
        .expect(403);

      expect(selectBuyerPaymentOption).not.toHaveBeenCalled();
    },
  );

  it('denies unauthenticated payment selection', async () => {
    await request(app.getHttpServer())
      .patch(`/orders/${safeOrder.id}/payment`)
      .send({ paymentOption: 'FULL' })
      .expect(401);

    expect(selectBuyerPaymentOption).not.toHaveBeenCalled();
  });

  it('does not return admin contact before payment selection', async () => {
    await request(app.getHttpServer())
      .get(`/orders/contact?orderId=${safeOrder.id}`)
      .set('Authorization', '******')
      .set('Authorization', 'Bearer buyer-token')
      .expect(409);

    expect(getBuyerOrder).toHaveBeenCalledWith('buyer-id', safeOrder.id);
    expect(getOfficialBuyerContact).not.toHaveBeenCalled();
  });

  it('rejects an invalid order ID before calling the service', async () => {
    await request(app.getHttpServer())
      .get('/orders/not-a-uuid')
      .set('Authorization', 'Bearer buyer-token')
      .expect(400);

    expect(getBuyerOrder).not.toHaveBeenCalled();
  });

  it('does not disclose an order that belongs to another buyer', async () => {
    getBuyerOrder.mockRejectedValueOnce(
      new NotFoundException('Order was not found.'),
    );

    await request(app.getHttpServer())
      .get(`/orders/${safeOrder.id}`)
      .set('Authorization', 'Bearer buyer-token')
      .expect(404);

    expect(getBuyerOrder).toHaveBeenCalledWith('buyer-id', safeOrder.id);
  });

  it('creates an order for the authenticated buyer and returns only safe fields', async () => {
    const input: CreateOrderDto = {
      items: [
        {
          variantId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
          quantity: 2,
        },
      ],
    };

    const response = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', 'Bearer buyer-token')
      .set('Idempotency-Key', 'checkout-key.1')
      .send(input)
      .expect(201);

    expect(createOrder).toHaveBeenCalledWith(
      'buyer-id',
      input,
      'checkout-key.1',
    );
    expect(response.body).toEqual(safeOrder);
    expect(response.body).not.toHaveProperty('buyerId');
    expect(response.body).not.toHaveProperty('requestHash');
    expect(response.body.items[0]).not.toHaveProperty('seller');
    expect(response.body.items[0]).not.toHaveProperty('phone');
  });

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'checkout-key')
      .send({ items: [] })
      .expect(401);

    expect(createOrder).not.toHaveBeenCalled();
  });

  it.each(['/orders', `/orders/${safeOrder.id}`])(
    'rejects unauthenticated history requests (%s)',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(401);

      expect(listBuyerOrders).not.toHaveBeenCalled();
      expect(getBuyerOrder).not.toHaveBeenCalled();
    },
  );

  it('rejects authenticated users without the buyer role', async () => {
    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', 'Bearer admin-token')
      .set('Idempotency-Key', 'checkout-key')
      .send({ items: [] })
      .expect(403);

    expect(createOrder).not.toHaveBeenCalled();
    expect(listBuyerOrders).not.toHaveBeenCalled();
    expect(getBuyerOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['admin-token', '/orders'],
    ['seller-token', '/orders'],
    ['inactive-buyer-token', '/orders'],
    ['admin-token', `/orders/${safeOrder.id}`],
    ['seller-token', `/orders/${safeOrder.id}`],
    ['inactive-buyer-token', `/orders/${safeOrder.id}`],
  ])(
    'rejects non-active buyers for buyer history routes (%s %s)',
    async (token, path) => {
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(listBuyerOrders).not.toHaveBeenCalled();
      expect(getBuyerOrder).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid DTO input without calling the order service', async () => {
    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', 'Bearer buyer-token')
      .set('Idempotency-Key', 'checkout-key')
      .send({
        buyerId: 'another-buyer',
        items: [
          {
            variantId: 'not-a-uuid',
            quantity: 0,
          },
        ],
      })
      .expect(400);

    expect(createOrder).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 'missing'],
    ['', 'empty'],
    ['has spaces', 'invalid format'],
    ['a'.repeat(256), 'too long'],
  ])(
    'requires a valid Idempotency-Key header (%s)',
    async (key, _description) => {
      const call = request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', 'Bearer buyer-token');
      if (key !== undefined) {
        call.set('Idempotency-Key', key);
      }

      await call
        .send({
          items: [
            {
              variantId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
              quantity: 1,
            },
          ],
        })
        .expect(400);

      expect(createOrder).not.toHaveBeenCalled();
    },
  );

  it('preserves idempotency conflicts and unavailable-product validation errors', async () => {
    createOrder.mockRejectedValueOnce(
      new ConflictException('Idempotency conflict.'),
    );
    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', 'Bearer buyer-token')
      .set('Idempotency-Key', 'checkout-key')
      .send({
        items: [
          {
            variantId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
            quantity: 1,
          },
        ],
      })
      .expect(409);

    createOrder.mockRejectedValueOnce(
      new BadRequestException('Selected variant is unavailable.'),
    );
    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', 'Bearer buyer-token')
      .set('Idempotency-Key', 'checkout-key-2')
      .send({
        items: [
          {
            variantId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
            quantity: 1,
          },
        ],
      })
      .expect(400);
  });
});
