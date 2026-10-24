import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOrderDto, OrdersPaginationDto } from './orders.dto.js';
import { OrdersService } from './orders.service.js';

const buyerId = 'buyer-id';
const variantOne = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const variantTwo = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

function eligibleVariant(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    productId: `product-${id}`,
    name: 'Large / Blue',
    price: '3.40',
    stockQuantity: 4,
    product: {
      id: `product-${id}`,
      titleEn: 'Linen shirt',
      titleAm: 'የበፍታ ሸሚዝ',
      status: 'APPROVED',
      category: { isActive: true },
      seller: {
        id: `seller-${id}`,
        status: 'APPROVED',
        user: { id: `seller-user-${id}`, status: 'ACTIVE' },
      },
    },
    ...overrides,
  };
}

function payloadHash(items: CreateOrderDto['items']): string {
  const canonicalItems = [...items].sort((left, right) =>
    left.variantId.localeCompare(right.variantId),
  );
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonicalItems.map(({ variantId, quantity }) => ({
          variantId,
          quantity,
        })),
      ),
    )
    .digest('hex');
}

function createStoredOrder(data: {
  buyerId: string;
  status: string;
  currency: string;
  total: { toString(): string };
  paymentOption?: 'DEPOSIT' | 'FULL' | null;
  requestHash: string | null;
  items: {
    create: {
      productId: string;
      variantId: string;
      productNameEn: string;
      productNameAm: string;
      variantName: string;
      quantity: number;
      unitPrice: { toString(): string };
      lineTotal: { toString(): string };
    }[];
  };
}) {
  const now = new Date('2026-10-21T12:00:00.000Z');
  return {
    id: 'order-id',
    buyerId: data.buyerId,
    status: data.status,
    paymentOption: data.paymentOption ?? null,
    currency: data.currency,
    total: data.total,
    requestHash: data.requestHash,
    createdAt: now,
    updatedAt: now,
    items: data.items.create.map((item, index) => ({
      id: `order-item-${index + 1}`,
      ...item,
    })),
  };
}

function createOrdersService(options?: {
  variants?: ReturnType<typeof eligibleVariant>[];
  transactionError?: unknown;
  existingOrder?: ReturnType<typeof createStoredOrder> | null;
}) {
  let storedOrder = options?.existingOrder ?? null;
  const findUnique = vi.fn(async () => {
    if (!storedOrder) {
      return null;
    }
    const { buyerId: _buyerId, ...existingOrder } = storedOrder;
    return existingOrder;
  });
  const findMany = vi
    .fn()
    .mockResolvedValue(options?.variants ?? [eligibleVariant(variantOne)]);
  const create = vi.fn(
    async ({ data }: { data: Parameters<typeof createStoredOrder>[0] }) => {
      storedOrder = createStoredOrder(data);
      const {
        buyerId: _buyerId,
        requestHash: _requestHash,
        ...safeOrder
      } = storedOrder;
      return safeOrder;
    },
  );
  const tx = {
    order: { findUnique, create },
    productVariant: { findMany },
  };
  const transaction = vi.fn(
    async (
      callback: (transaction: typeof tx) => Promise<unknown>,
      _options?: unknown,
    ) => {
      if (options?.transactionError) {
        throw options.transactionError;
      }
      return callback(tx);
    },
  );
  const prisma = {
    $transaction: transaction,
    order: { findUnique },
  } as unknown as PrismaService;

  return {
    service: new OrdersService(prisma),
    transaction,
    tx,
    findMany,
    create,
  };
}

const oneItemOrder: CreateOrderDto = {
  items: [{ variantId: variantOne, quantity: 2 }],
};

function existingOrderFor(items: CreateOrderDto['items']) {
  return createStoredOrder({
    buyerId,
    status: 'PENDING',
    paymentOption: null,
    paymentAmount: null,
    currency: 'ETB',
    total: { toString: () => '6.8' },
    requestHash: payloadHash(items),
    items: {
      create: [
        {
          productId: `product-${variantOne}`,
          variantId: variantOne,
          productNameEn: 'Linen shirt',
          productNameAm: 'የበፍታ ሸሚዝ',
          variantName: 'Large / Blue',
          quantity: 2,
          unitPrice: { toString: () => '3.4' },
          lineTotal: { toString: () => '6.8' },
        },
      ],
    },
  });
}

const safeReadOrder = {
  id: 'order-id',
  status: 'PENDING',
  paymentOption: null,
  paymentAmount: null,
  currency: 'ETB',
  total: '6.80',
  createdAt: new Date('2026-10-21T12:00:00.000Z'),
  updatedAt: new Date('2026-10-21T12:00:00.000Z'),
  items: [
    {
      id: 'order-item-id',
      productId: 'product-id',
      variantId: variantOne,
      productNameEn: 'Linen shirt',
      productNameAm: 'የበፍታ ሸሚዝ',
      variantName: 'Large / Blue',
      quantity: 2,
      unitPrice: '3.40',
      lineTotal: '6.80',
    },
  ],
};

const safeOrderSelect = {
  id: true,
  status: true,
  paymentOption: true,
  currency: true,
  total: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      productId: true,
      variantId: true,
      productNameEn: true,
      productNameAm: true,
      variantName: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
    },
  },
};

function createStockConfirmationService(options?: {
  items?: { variantId: string | null; quantity: number }[];
  inventory?: Record<string, number>;
  reservations?: {
    variantId: string;
    quantity: number;
    releasedAt: Date | null;
  }[];
  failReservationVariant?: string;
}) {
  const inventory = new Map(
    Object.entries(
      options?.inventory ?? {
        [variantOne]: 4,
        [variantTwo]: 4,
      },
    ),
  );
  const reservations = [...(options?.reservations ?? [])];
  const order = {
    id: safeReadOrder.id,
    status: 'PENDING',
    items: options?.items ?? [
      { variantId: variantOne, quantity: 2 },
      { variantId: variantTwo, quantity: 1 },
    ],
    stockReservations: reservations,
  };
  const findUnique = vi.fn(
    async ({ select }: { select: Record<string, unknown> }) =>
      'stockReservations' in select ? order : safeReadOrder,
  );
  const findMany = vi.fn(async () =>
    [...inventory].map(([id, stockQuantity]) => ({ id, stockQuantity })),
  );
  const updateMany = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string; stockQuantity: { gte: number } };
      data: { stockQuantity: { decrement: number } };
    }) => {
      const stock = inventory.get(where.id);
      if (stock === undefined || stock < where.stockQuantity.gte) {
        return { count: 0 };
      }
      inventory.set(where.id, stock - data.stockQuantity.decrement);
      return { count: 1 };
    },
  );
  const createReservation = vi.fn(
    async ({
      data,
    }: {
      data: { orderId: string; variantId: string; quantity: number };
    }) => {
      if (data.variantId === options?.failReservationVariant) {
        throw new Error('Reservation write failed.');
      }
      reservations.push({
        variantId: data.variantId,
        quantity: data.quantity,
        releasedAt: null,
      });
      return data;
    },
  );
  const tx = {
    order: { findUnique },
    productVariant: { findMany, updateMany },
    orderStockReservation: { create: createReservation },
  };
  const transaction = vi.fn(
    async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      const inventorySnapshot = new Map(inventory);
      const reservationSnapshot = [...reservations];
      try {
        return await callback(tx);
      } catch (error) {
        inventory.clear();
        for (const [id, stock] of inventorySnapshot) {
          inventory.set(id, stock);
        }
        reservations.splice(0, reservations.length, ...reservationSnapshot);
        throw error;
      }
    },
  );
  const prisma = { $transaction: transaction } as unknown as PrismaService;

  return {
    service: new OrdersService(prisma),
    transaction,
    findUnique,
    findMany,
    updateMany,
    createReservation,
    inventory,
    reservations,
  };
}

function createOrderWorkflowService(options?: {
  buyerId?: string;
  status?: string;
  total?: string;
  paymentOption?: 'DEPOSIT' | 'FULL' | null;
  items?: { variantId: string | null; quantity: number }[];
  reservations?: {
    id: string;
    variantId: string;
    quantity: number;
    releasedAt: Date | null;
  }[];
  inventory?: Record<string, number>;
  failRestoreVariant?: string;
}) {
  const order = {
    id: safeReadOrder.id,
    buyerId: options?.buyerId ?? buyerId,
    status: options?.status ?? 'PENDING',
    total: new Prisma.Decimal(options?.total ?? '10.01'),
    paymentOption: options?.paymentOption ?? null,
  };
  const items = options?.items ?? [{ variantId: variantOne, quantity: 2 }];
  const reservations = options?.reservations ?? [
    {
      id: 'reservation-one',
      variantId: variantOne,
      quantity: 2,
      releasedAt: null,
    },
  ];
  const inventory = new Map(
    Object.entries(options?.inventory ?? { [variantOne]: 1 }),
  );

  function getOrderForRead() {
    return {
      ...safeReadOrder,
      status: order.status,
      paymentOption: order.paymentOption,
      total: order.total,
    };
  }

  function getTransactionOrder(select: Record<string, unknown>) {
    if ('stockReservations' in select) {
      const reservationSelection = select.stockReservations as {
        where?: { releasedAt?: null };
      };
      return {
        id: order.id,
        status: order.status,
        ...('total' in select ? { total: order.total } : {}),
        ...('items' in select ? { items } : {}),
        stockReservations: reservations.filter(
          (reservation) =>
            !reservationSelection.where ||
            (reservationSelection.where.releasedAt === null &&
              reservation.releasedAt === null),
        ),
      };
    }
    return getOrderForRead();
  }

  const findUnique = vi.fn(
    async ({ select }: { select: Record<string, unknown> }) =>
      getTransactionOrder(select),
  );
  const findFirst = vi.fn(
    async ({
      where,
      select,
    }: {
      where: { id: string; buyerId?: string };
      select: Record<string, unknown>;
    }) => {
      if (
        where.id !== order.id ||
        (where.buyerId !== undefined && where.buyerId !== order.buyerId)
      ) {
        return null;
      }
      return getTransactionOrder(select);
    },
  );
  const updateOrderMany = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string; buyerId?: string; status?: string };
      data: { status?: string; paymentOption?: 'DEPOSIT' | 'FULL' };
    }) => {
      if (
        where.id !== order.id ||
        (where.buyerId !== undefined && where.buyerId !== order.buyerId) ||
        (where.status !== undefined && where.status !== order.status)
      ) {
        return { count: 0 };
      }
      if (data.status !== undefined) {
        order.status = data.status;
      }
      if (data.paymentOption !== undefined) {
        order.paymentOption = data.paymentOption;
      }
      return { count: 1 };
    },
  );
  const updateReservationMany = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string; releasedAt: null };
      data: { releasedAt: Date };
    }) => {
      const reservation = reservations.find(
        (entry) =>
          entry.id === where.id && entry.releasedAt === where.releasedAt,
      );
      if (!reservation) {
        return { count: 0 };
      }
      reservation.releasedAt = data.releasedAt;
      return { count: 1 };
    },
  );
  const updateVariantMany = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string; stockQuantity?: { gte: number } };
      data: { stockQuantity: { increment?: number; decrement?: number } };
    }) => {
      if (where.id === options?.failRestoreVariant) {
        throw new Error('Stock restore failed.');
      }
      const stock = inventory.get(where.id);
      if (
        stock === undefined ||
        (where.stockQuantity?.gte !== undefined &&
          stock < where.stockQuantity.gte)
      ) {
        return { count: 0 };
      }
      inventory.set(
        where.id,
        stock +
          (data.stockQuantity.increment ?? 0) -
          (data.stockQuantity.decrement ?? 0),
      );
      return { count: 1 };
    },
  );
  const tx = {
    order: {
      findUnique,
      findFirst,
      updateMany: updateOrderMany,
    },
    orderStockReservation: { updateMany: updateReservationMany },
    productVariant: { updateMany: updateVariantMany },
  };
  const transaction = vi.fn(
    async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      const orderSnapshot = { ...order };
      const inventorySnapshot = new Map(inventory);
      const reservationSnapshot = reservations.map((entry) => ({ ...entry }));
      try {
        return await callback(tx);
      } catch (error) {
        Object.assign(order, orderSnapshot);
        inventory.clear();
        for (const [id, stock] of inventorySnapshot) {
          inventory.set(id, stock);
        }
        reservations.splice(0, reservations.length, ...reservationSnapshot);
        throw error;
      }
    },
  );
  const prisma = {
    $transaction: transaction,
    order: { findMany: vi.fn(), findFirst },
  } as unknown as PrismaService;

  return {
    service: new OrdersService(prisma),
    order,
    reservations,
    inventory,
    transaction,
    findUnique,
    findFirst,
    updateOrderMany,
    updateReservationMany,
    updateVariantMany,
  };
}

describe('OrdersService admin order management', () => {
  it('lists all orders with pagination and a safe projection', async () => {
    const findMany = vi.fn().mockResolvedValue([safeReadOrder]);
    const prisma = {
      order: { findMany },
    } as unknown as PrismaService;
    const service = new OrdersService(prisma);

    await expect(
      service.listAdminOrders({ page: 2, limit: 10 }),
    ).resolves.toEqual([safeReadOrder]);
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
      select: safeOrderSelect,
    });
    expect(findMany.mock.calls[0][0]).not.toHaveProperty('where');
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('buyerId');
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty(
      'idempotencyKey',
    );
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('requestHash');
  });

  it('gets an order by ID with a safe projection', async () => {
    const findUnique = vi.fn().mockResolvedValue(safeReadOrder);
    const prisma = {
      order: { findUnique },
    } as unknown as PrismaService;
    const service = new OrdersService(prisma);

    await expect(service.getAdminOrder('order-id')).resolves.toEqual(
      safeReadOrder,
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'order-id' },
      select: safeOrderSelect,
    });
  });

  it('returns not found when getting a missing order', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = {
      order: { findUnique },
    } as unknown as PrismaService;
    const service = new OrdersService(prisma);

    await expect(service.getAdminOrder('missing-order')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'missing-order' } }),
    );
  });

  it('updates an order through an allowed status transition', async () => {
    const cancelledOrder = { ...safeReadOrder, status: 'CANCELLED' };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({
        id: safeReadOrder.id,
        status: 'PENDING',
        stockReservations: [],
      })
      .mockResolvedValueOnce(cancelledOrder);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transactionClient = {
      order: { findUnique, updateMany },
    };
    const transaction = vi.fn(
      async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    );
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new OrdersService(prisma);

    await expect(
      service.updateAdminOrderStatus(safeReadOrder.id, 'CANCELLED'),
    ).resolves.toEqual(cancelledOrder);
    expect(transaction).toHaveBeenCalledOnce();
    expect(findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: safeReadOrder.id },
      select: {
        id: true,
        status: true,
        stockReservations: {
          where: { releasedAt: null },
          select: { id: true, variantId: true, quantity: true },
        },
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: safeReadOrder.id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    expect(findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: safeReadOrder.id },
      select: safeOrderSelect,
    });
    expect(cancelledOrder).not.toHaveProperty('requestHash');
  });

  it('rejects an invalid status transition', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: safeReadOrder.id,
      status: 'COMPLETED',
      stockReservations: [],
    });
    const updateMany = vi.fn();
    const transactionClient = {
      order: { findUnique, updateMany },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
          callback(transactionClient),
      ),
    } as unknown as PrismaService;
    const service = new OrdersService(prisma);

    await expect(
      service.updateAdminOrderStatus(safeReadOrder.id, 'CONFIRMED'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('returns not found when updating a missing order', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const updateMany = vi.fn();
    const transactionClient = {
      order: { findUnique, updateMany },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
          callback(transactionClient),
      ),
    } as unknown as PrismaService;
    const service = new OrdersService(prisma);

    await expect(
      service.updateAdminOrderStatus('missing-order', 'CONFIRMED'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('OrdersService.confirmAdminOrderStock', () => {
  it('decreases available stock and creates reservations while keeping the order pending', async () => {
    const context = createStockConfirmationService();

    await expect(
      context.service.confirmAdminOrderStock(safeReadOrder.id),
    ).resolves.toEqual(safeReadOrder);

    expect(context.transaction).toHaveBeenCalledOnce();
    expect(context.inventory).toEqual(
      new Map([
        [variantOne, 2],
        [variantTwo, 3],
      ]),
    );
    expect(context.reservations).toEqual([
      { variantId: variantOne, quantity: 2, releasedAt: null },
      { variantId: variantTwo, quantity: 1, releasedAt: null },
    ]);
    expect(context.updateMany).toHaveBeenCalledWith({
      where: { id: variantOne, stockQuantity: { gte: 2 } },
      data: { stockQuantity: { decrement: 2 } },
    });
    expect(safeReadOrder.status).toBe('PENDING');
  });

  it('rejects insufficient stock without changing any variant', async () => {
    const context = createStockConfirmationService({
      inventory: { [variantOne]: 1, [variantTwo]: 4 },
    });

    await expect(
      context.service.confirmAdminOrderStock(safeReadOrder.id),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(context.inventory).toEqual(
      new Map([
        [variantOne, 1],
        [variantTwo, 4],
      ]),
    );
    expect(context.updateMany).not.toHaveBeenCalled();
    expect(context.reservations).toHaveLength(0);
  });

  it('rolls back earlier stock updates and reservations if a later write fails', async () => {
    const context = createStockConfirmationService({
      failReservationVariant: variantTwo,
    });

    await expect(
      context.service.confirmAdminOrderStock(safeReadOrder.id),
    ).rejects.toThrow('Reservation write failed.');

    expect(context.inventory).toEqual(
      new Map([
        [variantOne, 4],
        [variantTwo, 4],
      ]),
    );
    expect(context.reservations).toHaveLength(0);
  });

  it('does not decrement stock or add reservations when already confirmed', async () => {
    const context = createStockConfirmationService();

    await context.service.confirmAdminOrderStock(safeReadOrder.id);
    const stockAfterFirstConfirmation = new Map(context.inventory);

    await expect(
      context.service.confirmAdminOrderStock(safeReadOrder.id),
    ).resolves.toEqual(safeReadOrder);

    expect(context.inventory).toEqual(stockAfterFirstConfirmation);
    expect(context.reservations).toHaveLength(2);
    expect(context.updateMany).toHaveBeenCalledTimes(2);
  });

  it('does not assume migrated pending legacy orders already have reservations', async () => {
    const context = createStockConfirmationService({
      items: [{ variantId: variantOne, quantity: 2 }],
      inventory: { [variantOne]: 3 },
    });

    await context.service.confirmAdminOrderStock(safeReadOrder.id);

    expect(context.inventory.get(variantOne)).toBe(1);
    expect(context.reservations).toEqual([
      { variantId: variantOne, quantity: 2, releasedAt: null },
    ]);
  });

  it('rejects an order item whose product variant no longer exists', async () => {
    const context = createStockConfirmationService({
      items: [{ variantId: 'missing-variant', quantity: 1 }],
    });

    await expect(
      context.service.confirmAdminOrderStock(safeReadOrder.id),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(context.updateMany).not.toHaveBeenCalled();
  });
});

describe('OrdersService buyer order history', () => {
  const buyerId = 'authenticated-buyer-id';

  function createReadService(options?: {
    orders?: (typeof safeReadOrder)[];
    order?: typeof safeReadOrder | null;
  }) {
    const findMany = vi
      .fn()
      .mockResolvedValue(options?.orders ?? [safeReadOrder]);
    const findFirst = vi
      .fn()
      .mockResolvedValue(
        options?.order === undefined ? safeReadOrder : options.order,
      );
    const prisma = {
      order: { findMany, findFirst },
    } as unknown as PrismaService;

    return { service: new OrdersService(prisma), findMany, findFirst };
  }

  it('lists only the buyer orders using stable pagination and a safe projection', async () => {
    const { service, findMany } = createReadService();
    const pagination = { page: 2, limit: 10 } as OrdersPaginationDto;

    await expect(service.listBuyerOrders(buyerId, pagination)).resolves.toEqual(
      [safeReadOrder],
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { buyerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
      select: safeOrderSelect,
    });

    const select = findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('buyerId');
    expect(select).not.toHaveProperty('idempotencyKey');
    expect(select).not.toHaveProperty('requestHash');
    expect(select.items.select).not.toHaveProperty('seller');
    expect(select.items.select).not.toHaveProperty('phone');
  });

  it('returns an empty list when the buyer has no orders', async () => {
    const { service, findMany } = createReadService({ orders: [] });

    await expect(
      service.listBuyerOrders(buyerId, { page: 1, limit: 20 }),
    ).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { buyerId }, skip: 0, take: 20 }),
    );
  });

  it('looks up a single order with both its ID and the authenticated buyer ID', async () => {
    const { service, findFirst } = createReadService();

    await expect(service.getBuyerOrder(buyerId, 'order-id')).resolves.toEqual(
      safeReadOrder,
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'order-id', buyerId },
      select: safeOrderSelect,
    });
  });

  it('returns not found when the order does not belong to the buyer', async () => {
    const { service, findFirst } = createReadService({ order: null });

    await expect(
      service.getBuyerOrder(buyerId, 'another-buyers-order'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'another-buyers-order', buyerId },
      }),
    );
  });
});

describe('OrdersService.selectBuyerPaymentOption', () => {
  it('calculates a half-up rounded deposit from the stored order total', async () => {
    const context = createOrderWorkflowService({ total: '10.01' });

    const selected = await context.service.selectBuyerPaymentOption(
      buyerId,
      safeReadOrder.id,
      'DEPOSIT',
    );

    expect(selected.total.toString()).toBe('10.01');
    expect(selected.paymentOption).toBe('DEPOSIT');
    expect(selected.paymentAmount?.toString()).toBe('5.01');
    expect(context.updateOrderMany).toHaveBeenCalledWith({
      where: { id: safeReadOrder.id, buyerId, status: 'PENDING' },
      data: { paymentOption: 'DEPOSIT' },
    });
  });

  it('uses the full stored total for the FULL option', async () => {
    const context = createOrderWorkflowService({ total: '10.01' });

    const selected = await context.service.selectBuyerPaymentOption(
      buyerId,
      safeReadOrder.id,
      'FULL',
    );

    expect(selected.paymentOption).toBe('FULL');
    expect(selected.paymentAmount?.toString()).toBe('10.01');
  });

  it('prevents payment selection before every item has an active reservation', async () => {
    const context = createOrderWorkflowService({ reservations: [] });

    await expect(
      context.service.selectBuyerPaymentOption(
        buyerId,
        safeReadOrder.id,
        'FULL',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(context.updateOrderMany).not.toHaveBeenCalled();
  });

  it('does not allow another buyer to select payment for the order', async () => {
    const context = createOrderWorkflowService();

    await expect(
      context.service.selectBuyerPaymentOption(
        'another-buyer',
        safeReadOrder.id,
        'DEPOSIT',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(context.updateOrderMany).not.toHaveBeenCalled();
  });

  it('presents a legacy CONFIRMED order as PENDING without permitting payment without reservations', async () => {
    const context = createOrderWorkflowService({
      status: 'CONFIRMED',
      reservations: [],
    });

    await expect(
      context.service.getBuyerOrder(buyerId, safeReadOrder.id),
    ).resolves.toMatchObject({ status: 'PENDING', paymentOption: null });
    await expect(
      context.service.selectBuyerPaymentOption(
        buyerId,
        safeReadOrder.id,
        'DEPOSIT',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('OrdersService order completion and cancellation', () => {
  it('manually completes an order without releasing reserved stock', async () => {
    const context = createOrderWorkflowService();

    const completed = await context.service.updateAdminOrderStatus(
      safeReadOrder.id,
      'COMPLETED',
    );

    expect(completed.status).toBe('COMPLETED');
    expect(context.inventory.get(variantOne)).toBe(1);
    expect(context.reservations[0].releasedAt).toBeNull();
    expect(context.updateVariantMany).not.toHaveBeenCalled();
  });

  it('cancels and releases active stock reservations exactly once', async () => {
    const context = createOrderWorkflowService();

    await context.service.updateAdminOrderStatus(safeReadOrder.id, 'CANCELLED');
    await context.service.updateAdminOrderStatus(safeReadOrder.id, 'CANCELLED');

    expect(context.order.status).toBe('CANCELLED');
    expect(context.inventory.get(variantOne)).toBe(3);
    expect(context.reservations[0].releasedAt).toBeInstanceOf(Date);
    expect(context.updateVariantMany).toHaveBeenCalledOnce();
    expect(context.updateReservationMany).toHaveBeenCalledOnce();
  });

  it('safely cancels an order with no reservations', async () => {
    const context = createOrderWorkflowService({ reservations: [] });

    await expect(
      context.service.updateAdminOrderStatus(safeReadOrder.id, 'CANCELLED'),
    ).resolves.toMatchObject({ status: 'CANCELLED' });

    expect(context.updateVariantMany).not.toHaveBeenCalled();
  });

  it('rolls cancellation and stock restoration back if restoring a variant fails', async () => {
    const context = createOrderWorkflowService({
      failRestoreVariant: variantOne,
    });

    await expect(
      context.service.updateAdminOrderStatus(safeReadOrder.id, 'CANCELLED'),
    ).rejects.toThrow('Stock restore failed.');

    expect(context.order.status).toBe('PENDING');
    expect(context.inventory.get(variantOne)).toBe(1);
    expect(context.reservations[0].releasedAt).toBeNull();
  });
});

describe('OrdersService.createOrder', () => {
  it('creates one order containing products from multiple sellers', async () => {
    const firstVariant = eligibleVariant(variantOne);
    const secondVariant = eligibleVariant(variantTwo);
    expect(firstVariant.product.seller.id).not.toBe(
      secondVariant.product.seller.id,
    );

    const context = createOrdersService({
      variants: [firstVariant, secondVariant],
    });

    const order = await context.service.createOrder(buyerId, {
      items: [
        { variantId: variantOne, quantity: 1 },
        { variantId: variantTwo, quantity: 2 },
      ],
    });

    expect(context.create).toHaveBeenCalledOnce();
    const data = context.create.mock.calls[0][0].data;
    expect(data.items.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: `product-${variantOne}`,
          variantId: variantOne,
          quantity: 1,
        }),
        expect.objectContaining({
          productId: `product-${variantTwo}`,
          variantId: variantTwo,
          quantity: 2,
        }),
      ]),
    );
    expect(order.items).toHaveLength(2);
    expect(data.buyerId).toBe(buyerId);
  });

  it('validates every requested variant against catalog eligibility and stock', async () => {
    const { service, findMany } = createOrdersService();

    await service.createOrder(buyerId, oneItemOrder);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [variantOne] },
        isActive: true,
        stockQuantity: { gt: 0 },
        product: {
          status: 'APPROVED',
          category: { isActive: true },
          seller: {
            status: 'APPROVED',
            user: { status: 'ACTIVE' },
          },
        },
      },
      select: expect.objectContaining({
        product: expect.objectContaining({
          select: expect.objectContaining({
            titleEn: true,
            seller: expect.any(Object),
          }),
        }),
      }),
    });
  });

  it('rejects variants that are not currently eligible', async () => {
    const { service, create } = createOrdersService({ variants: [] });

    await expect(
      service.createOrder(buyerId, oneItemOrder),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an eligible variant when its available stock is insufficient', async () => {
    const { service, create } = createOrdersService({
      variants: [eligibleVariant(variantOne, { stockQuantity: 1 })],
    });

    await expect(
      service.createOrder(buyerId, oneItemOrder),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a variant whose product relation does not match its product ID', async () => {
    const variant = eligibleVariant(variantOne, {
      product: {
        ...eligibleVariant(variantOne).product,
        id: 'different-product-id',
      },
    });
    const { service, create } = createOrdersService({ variants: [variant] });

    await expect(
      service.createOrder(buyerId, oneItemOrder),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('uses database prices and exact decimal arithmetic for snapshots and totals', async () => {
    const { service, create } = createOrdersService({
      variants: [
        eligibleVariant(variantOne, { price: '3.40' }),
        eligibleVariant(variantTwo, { price: '4.40' }),
      ],
    });
    const order = await service.createOrder(buyerId, {
      items: [
        { variantId: variantOne, quantity: 2 },
        { variantId: variantTwo, quantity: 1 },
      ],
    });

    expect(create).toHaveBeenCalledOnce();
    const data = create.mock.calls[0][0].data;
    expect(data.currency).toBe('ETB');
    expect(data.status).toBe('PENDING');
    expect(data.total.toString()).toBe('11.2');
    expect(data.items.create).toEqual([
      expect.objectContaining({
        productNameEn: 'Linen shirt',
        productNameAm: 'የበፍታ ሸሚዝ',
        variantName: 'Large / Blue',
        quantity: 2,
        unitPrice: expect.objectContaining({ toString: expect.any(Function) }),
        lineTotal: expect.objectContaining({ toString: expect.any(Function) }),
      }),
      expect.objectContaining({
        variantId: variantTwo,
        unitPrice: expect.objectContaining({ toString: expect.any(Function) }),
      }),
    ]);
    expect(data.items.create[0].unitPrice.toString()).toBe('3.4');
    expect(data.items.create[0].lineTotal.toString()).toBe('6.8');
    expect(order.total.toString()).toBe('11.2');
    expect(order).not.toHaveProperty('buyerId');
    expect(order).not.toHaveProperty('requestHash');
    expect(order.items[0]).not.toHaveProperty('seller');
  });

  it('creates order and items atomically without changing stock', async () => {
    const context = createOrdersService();

    await context.service.createOrder(buyerId, oneItemOrder);

    expect(context.transaction).toHaveBeenCalledOnce();
    expect(context.transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'Serializable',
    });
    expect(context.findMany).toHaveBeenCalledOnce();
    expect(context.create).toHaveBeenCalledOnce();
    expect(context.tx.productVariant).not.toHaveProperty('update');
    expect(context.tx.productVariant).not.toHaveProperty('updateMany');
  });

  it('returns the existing order when the same buyer retries the same key and payload', async () => {
    const context = createOrdersService();
    const created = await context.service.createOrder(
      buyerId,
      oneItemOrder,
      'checkout-key',
    );
    const retried = await context.service.createOrder(
      buyerId,
      oneItemOrder,
      'checkout-key',
    );

    expect(retried).toEqual(created);
    expect(context.create).toHaveBeenCalledOnce();
    expect(context.transaction).toHaveBeenCalledTimes(2);
  });

  it('rejects reuse of an idempotency key with a different payload', async () => {
    const context = createOrdersService();
    await context.service.createOrder(buyerId, oneItemOrder, 'checkout-key');

    await expect(
      context.service.createOrder(
        buyerId,
        { items: [{ variantId: variantOne, quantity: 3 }] },
        'checkout-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(context.create).toHaveBeenCalledOnce();
  });

  it('returns the winning order after a concurrent unique-key conflict', async () => {
    const existingOrder = existingOrderFor(oneItemOrder.items);
    const { service, create } = createOrdersService({
      transactionError: { code: 'P2002' },
      existingOrder,
    });

    await expect(
      service.createOrder(buyerId, oneItemOrder, 'checkout-key'),
    ).resolves.toMatchObject({ id: 'order-id' });
    expect(create).not.toHaveBeenCalled();
  });

  it('returns the winning order after a concurrent serialization conflict', async () => {
    const existingOrder = existingOrderFor(oneItemOrder.items);
    const { service, transaction, create } = createOrdersService({
      transactionError: { code: 'P2034' },
      existingOrder,
    });

    await expect(
      service.createOrder(buyerId, oneItemOrder, 'checkout-key'),
    ).resolves.toMatchObject({ id: 'order-id' });
    expect(transaction).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it('retries serialization failures a bounded number of times when no concurrent order is visible', async () => {
    const { service, transaction } = createOrdersService({
      transactionError: { code: 'P2034' },
    });

    await expect(
      service.createOrder(buyerId, oneItemOrder, 'checkout-key'),
    ).rejects.toMatchObject({ code: 'P2034' });
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});
