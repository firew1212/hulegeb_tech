import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type {
  OrderStatus,
  PaymentOption,
} from '../../generated/prisma/enums.js';
import { CreateOrderDto, OrdersPaginationDto } from './orders.dto.js';

const MAX_ORDER_LINES = 20;
const MAX_LINE_QUANTITY = 10;
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const MAX_SERIALIZATION_RETRIES = 2;

const orderSelect = {
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
} satisfies Prisma.OrderSelect;

const orderWithHashSelect = {
  ...orderSelect,
  requestHash: true,
} satisfies Prisma.OrderSelect;

const checkoutVariantSelect = {
  id: true,
  productId: true,
  name: true,
  price: true,
  stockQuantity: true,
  product: {
    select: {
      id: true,
      titleEn: true,
      titleAm: true,
      status: true,
      category: { select: { isActive: true } },
      seller: {
        select: {
          status: true,
          user: { select: { status: true } },
        },
      },
    },
  },
} satisfies Prisma.ProductVariantSelect;

type SafeOrder = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;
type OrderResponse = Omit<SafeOrder, 'status'> & {
  status: Exclude<OrderStatus, 'CONFIRMED'>;
  paymentAmount: string | null;
};
type OrderWithHash = Prisma.OrderGetPayload<{
  select: typeof orderWithHashSelect;
}>;

const allowedOrderStatusTransitions: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['COMPLETED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async listAdminOrders(
    pagination: OrdersPaginationDto,
  ): Promise<OrderResponse[]> {
    const orders = await this.prisma.order.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
      select: orderSelect,
    });
    return orders.map((order) => this.toOrderResponse(order));
  }

  async getAdminOrder(orderId: string): Promise<OrderResponse> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: orderSelect,
    });
    if (!order) {
      throw new NotFoundException('Order was not found.');
    }
    return this.toOrderResponse(order);
  }

  confirmAdminOrderStock(orderId: string): Promise<OrderResponse> {
    return this.confirmAdminOrderStockTransaction(orderId, 0);
  }

  private async confirmAdminOrderStockTransaction(
    orderId: string,
    retry: number,
  ): Promise<OrderResponse> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: orderId },
            select: {
              id: true,
              status: true,
              items: {
                select: { variantId: true, quantity: true },
              },
              stockReservations: {
                select: { variantId: true, quantity: true, releasedAt: true },
              },
            },
          });
          if (!order) {
            throw new NotFoundException('Order was not found.');
          }
          if (order.status !== 'PENDING') {
            throw new ConflictException(
              'Only pending orders can have stock confirmed.',
            );
          }

          const requiredQuantities = new Map<string, number>();
          for (const item of order.items) {
            if (
              !item.variantId ||
              !Number.isInteger(item.quantity) ||
              item.quantity < 1
            ) {
              throw new ConflictException(
                'The order contains an item that cannot be reserved.',
              );
            }
            requiredQuantities.set(
              item.variantId,
              (requiredQuantities.get(item.variantId) ?? 0) + item.quantity,
            );
          }
          if (requiredQuantities.size === 0) {
            throw new ConflictException('The order has no reservable items.');
          }

          if (order.stockReservations.length > 0) {
            const hasMatchingActiveReservations =
              order.stockReservations.length === requiredQuantities.size &&
              order.stockReservations.every(
                (reservation) =>
                  reservation.releasedAt === null &&
                  requiredQuantities.get(reservation.variantId) ===
                    reservation.quantity,
              );
            if (!hasMatchingActiveReservations) {
              throw new ConflictException(
                'The order has an incomplete or inconsistent stock reservation.',
              );
            }
            const existingOrder = await tx.order.findUnique({
              where: { id: order.id },
              select: orderSelect,
            });
            if (!existingOrder) {
              throw new NotFoundException('Order was not found.');
            }
            return this.toOrderResponse(existingOrder);
          }

          const variantIds = [...requiredQuantities.keys()].sort();
          const variants = await tx.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, stockQuantity: true },
          });
          const variantsById = new Map(
            variants.map((variant) => [variant.id, variant]),
          );
          if (variantsById.size !== requiredQuantities.size) {
            throw new ConflictException(
              'One or more ordered product variants no longer exist.',
            );
          }

          for (const variantId of variantIds) {
            const quantity = requiredQuantities.get(variantId);
            const variant = variantsById.get(variantId);
            if (quantity === undefined || !variant) {
              throw new ConflictException(
                'One or more ordered product variants no longer exist.',
              );
            }
            if (variant.stockQuantity < quantity) {
              throw new BadRequestException(
                'One or more ordered variants do not have enough stock.',
              );
            }

            const updated = await tx.productVariant.updateMany({
              where: { id: variantId, stockQuantity: { gte: quantity } },
              data: { stockQuantity: { decrement: quantity } },
            });
            if (updated.count !== 1) {
              throw new BadRequestException(
                'One or more ordered variants do not have enough stock.',
              );
            }

            await tx.orderStockReservation.create({
              data: { orderId: order.id, variantId, quantity },
            });
          }

          const confirmedOrder = await tx.order.findUnique({
            where: { id: order.id },
            select: orderSelect,
          });
          if (!confirmedOrder) {
            throw new NotFoundException('Order was not found.');
          }
          return this.toOrderResponse(confirmedOrder);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        (this.hasPrismaErrorCode(error, 'P2034') ||
          this.hasPrismaErrorCode(error, 'P2002')) &&
        retry < MAX_SERIALIZATION_RETRIES
      ) {
        return this.confirmAdminOrderStockTransaction(orderId, retry + 1);
      }
      throw error;
    }
  }

  updateAdminOrderStatus(
    orderId: string,
    status: OrderStatus,
  ): Promise<OrderResponse> {
    return this.updateAdminOrderStatusTransaction(orderId, status, 0);
  }

  private async updateAdminOrderStatusTransaction(
    orderId: string,
    status: OrderStatus,
    retry: number,
  ): Promise<OrderResponse> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: orderId },
            select: {
              id: true,
              buyerId: true,
              status: true,
              paymentOption: true,
              stockReservations: {
                where: { releasedAt: null },
                select: { id: true, variantId: true, quantity: true },
              },
            },
          });
          if (!order) {
            throw new NotFoundException('Order was not found.');
          }
          const isRepeatedCancellation =
            order.status === 'CANCELLED' && status === 'CANCELLED';
          if (
            !isRepeatedCancellation &&
            !allowedOrderStatusTransitions[order.status].includes(status)
          ) {
            throw new ConflictException(
              `Order cannot transition from ${order.status} to ${status}.`,
            );
          }
          if (status === 'COMPLETED') {
            if (order.stockReservations.length === 0) {
              throw new ConflictException(
                'Stock must be actively reserved before completing the order.',
              );
            }
            if (
              order.paymentOption !== 'DEPOSIT' &&
              order.paymentOption !== 'FULL'
            ) {
              throw new ConflictException(
                'A payment option must be selected before completing the order.',
              );
            }
          }

          if (!isRepeatedCancellation) {
            const updated = await tx.order.updateMany({
              where: { id: order.id, status: order.status },
              data: { status },
            });
            if (updated.count !== 1) {
              throw new ConflictException('Order status has changed.');
            }
            if (status === 'CANCELLED' || status === 'COMPLETED') {
              await tx.notification.create({
                data: {
                  type:
                    status === 'CANCELLED'
                      ? 'ORDER_CANCELLED'
                      : 'ORDER_COMPLETED',
                  userId: order.buyerId,
                  resourceId: order.id,
                },
              });
            }
          }

          if (status === 'CANCELLED') {
            for (const reservation of order.stockReservations) {
              if (
                !Number.isInteger(reservation.quantity) ||
                reservation.quantity < 1
              ) {
                throw new ConflictException(
                  'The order has an invalid stock reservation.',
                );
              }
              const releasedAt = new Date();
              const released = await tx.orderStockReservation.updateMany({
                where: { id: reservation.id, releasedAt: null },
                data: { releasedAt },
              });
              if (released.count === 1) {
                const restored = await tx.productVariant.updateMany({
                  where: { id: reservation.variantId },
                  data: { stockQuantity: { increment: reservation.quantity } },
                });
                if (restored.count !== 1) {
                  throw new ConflictException(
                    'A reserved product variant could not be restored.',
                  );
                }
              }
            }
          }

          const updatedOrder = await tx.order.findUnique({
            where: { id: order.id },
            select: orderSelect,
          });
          if (!updatedOrder) {
            throw new NotFoundException('Order was not found.');
          }
          return this.toOrderResponse(updatedOrder);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        this.hasPrismaErrorCode(error, 'P2034') &&
        retry < MAX_SERIALIZATION_RETRIES
      ) {
        return this.updateAdminOrderStatusTransaction(
          orderId,
          status,
          retry + 1,
        );
      }
      throw error;
    }
  }

  listBuyerOrders(
    buyerId: string,
    pagination: OrdersPaginationDto,
  ): Promise<OrderResponse[]> {
    return this.prisma.order
      .findMany({
        where: { buyerId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
        select: orderSelect,
      })
      .then((orders) => orders.map((order) => this.toOrderResponse(order)));
  }

  async getBuyerOrder(
    buyerId: string,
    orderId: string,
  ): Promise<OrderResponse> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, buyerId },
      select: orderSelect,
    });
    if (!order) {
      throw new NotFoundException('Order was not found.');
    }
    return this.toOrderResponse(order);
  }

  async getBuyerOrderByIdempotencyKey(
    buyerId: string,
    idempotencyKey: string,
  ): Promise<OrderResponse | null> {
    const existing = await this.findExistingOrder(buyerId, idempotencyKey);
    if (!existing) {
      return null;
    }
    const { requestHash: _requestHash, ...safeOrder } = existing;
    return this.toOrderResponse(safeOrder);
  }

  private assertActiveReservationsMatchItems(
    items: { variantId: string | null; quantity: number }[],
    reservations: { variantId: string; quantity: number }[],
  ): void {
    const requiredQuantities = new Map<string, number>();
    for (const item of items) {
      if (
        !item.variantId ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1
      ) {
        throw new ConflictException(
          'The order contains an item that cannot be reserved.',
        );
      }
      requiredQuantities.set(
        item.variantId,
        (requiredQuantities.get(item.variantId) ?? 0) + item.quantity,
      );
    }
    if (
      requiredQuantities.size === 0 ||
      reservations.length !== requiredQuantities.size ||
      reservations.some(
        (reservation) =>
          requiredQuantities.get(reservation.variantId) !==
          reservation.quantity,
      )
    ) {
      throw new ConflictException(
        'Stock must be confirmed for every order item before payment selection.',
      );
    }
  }

  selectBuyerPaymentOption(
    buyerId: string,
    orderId: string,
    paymentOption: PaymentOption,
  ): Promise<OrderResponse> {
    if (paymentOption !== 'DEPOSIT' && paymentOption !== 'FULL') {
      throw new BadRequestException('The payment option is invalid.');
    }
    return this.selectBuyerPaymentOptionTransaction(
      buyerId,
      orderId,
      paymentOption,
      0,
    );
  }

  private async selectBuyerPaymentOptionTransaction(
    buyerId: string,
    orderId: string,
    paymentOption: PaymentOption,
    retry: number,
  ): Promise<OrderResponse> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const order = await tx.order.findFirst({
            where: { id: orderId, buyerId },
            select: {
              id: true,
              status: true,
              total: true,
              items: { select: { variantId: true, quantity: true } },
              stockReservations: {
                where: { releasedAt: null },
                select: { variantId: true, quantity: true },
              },
            },
          });
          if (!order) {
            throw new NotFoundException('Order was not found.');
          }
          if (order.status !== 'PENDING') {
            throw new ConflictException(
              'Payment can only be selected for a pending order.',
            );
          }
          this.assertActiveReservationsMatchItems(
            order.items,
            order.stockReservations,
          );

          const updated = await tx.order.updateMany({
            where: { id: order.id, buyerId, status: 'PENDING' },
            data: { paymentOption },
          });
          if (updated.count !== 1) {
            throw new ConflictException('Order status has changed.');
          }

          const updatedOrder = await tx.order.findFirst({
            where: { id: order.id, buyerId },
            select: orderSelect,
          });
          if (!updatedOrder) {
            throw new NotFoundException('Order was not found.');
          }
          return this.toOrderResponse(updatedOrder);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        this.hasPrismaErrorCode(error, 'P2034') &&
        retry < MAX_SERIALIZATION_RETRIES
      ) {
        return this.selectBuyerPaymentOptionTransaction(
          buyerId,
          orderId,
          paymentOption,
          retry + 1,
        );
      }
      throw error;
    }
  }

  async createOrder(
    buyerId: string,
    input: CreateOrderDto,
    idempotencyKey?: string,
  ): Promise<OrderResponse> {
    this.validateInput(input);
    this.validateIdempotencyKey(idempotencyKey);

    const items = [...input.items].sort((left, right) =>
      left.variantId.localeCompare(right.variantId),
    );
    const requestHash = idempotencyKey ? this.hashRequest(items) : undefined;

    return this.createOrderTransaction(
      buyerId,
      items,
      idempotencyKey,
      requestHash,
      0,
    );
  }

  private async createOrderTransaction(
    buyerId: string,
    items: CreateOrderDto['items'],
    idempotencyKey: string | undefined,
    requestHash: string | undefined,
    retry: number,
  ): Promise<OrderResponse> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if (idempotencyKey) {
            const existing = await tx.order.findUnique({
              where: {
                buyerId_idempotencyKey: { buyerId, idempotencyKey },
              },
              select: orderWithHashSelect,
            });
            if (existing) {
              return this.getExistingOrder(existing, requestHash!);
            }
          }

          const variants = await tx.productVariant.findMany({
            where: {
              id: { in: items.map(({ variantId }) => variantId) },
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
            select: checkoutVariantSelect,
          });
          const variantsById = new Map(
            variants.map((variant) => [variant.id, variant]),
          );
          const orderItems = items.map((item) => {
            const variant = variantsById.get(item.variantId);
            if (!variant) {
              throw new BadRequestException(
                'One or more selected variants are unavailable.',
              );
            }
            if (variant.productId !== variant.product.id) {
              throw new BadRequestException(
                'A selected variant does not belong to its product.',
              );
            }
            if (variant.stockQuantity < item.quantity) {
              throw new BadRequestException(
                'One or more selected variants do not have enough stock.',
              );
            }

            const unitPrice = new Prisma.Decimal(variant.price);
            const lineTotal = unitPrice.mul(item.quantity);
            return {
              productId: variant.product.id,
              variantId: variant.id,
              productNameEn: variant.product.titleEn,
              productNameAm: variant.product.titleAm,
              variantName: variant.name,
              quantity: item.quantity,
              unitPrice,
              lineTotal,
            };
          });
          const total = orderItems.reduce(
            (sum, item) => sum.plus(item.lineTotal),
            new Prisma.Decimal(0),
          );

          // Stock is checked at checkout but is not reserved or decremented.
          const order = await tx.order.create({
            data: {
              buyerId,
              status: 'PENDING',
              currency: 'ETB',
              total,
              idempotencyKey: idempotencyKey ?? null,
              requestHash: requestHash ?? null,
              items: { create: orderItems },
            },
            select: orderSelect,
          });
          return this.toOrderResponse(order);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (idempotencyKey && this.hasPrismaErrorCode(error, 'P2002')) {
        const existing = await this.findExistingOrder(buyerId, idempotencyKey);
        if (existing) {
          return this.getExistingOrder(existing, requestHash!);
        }
        throw error;
      }

      if (this.hasPrismaErrorCode(error, 'P2034')) {
        if (idempotencyKey) {
          const existing = await this.findExistingOrder(
            buyerId,
            idempotencyKey,
          );
          if (existing) {
            return this.getExistingOrder(existing, requestHash!);
          }
        }
        if (retry < MAX_SERIALIZATION_RETRIES) {
          return this.createOrderTransaction(
            buyerId,
            items,
            idempotencyKey,
            requestHash,
            retry + 1,
          );
        }
      }

      throw error;
    }
  }

  private async findExistingOrder(
    buyerId: string,
    idempotencyKey: string,
  ): Promise<OrderWithHash | null> {
    return this.prisma.order.findUnique({
      where: {
        buyerId_idempotencyKey: { buyerId, idempotencyKey },
      },
      select: orderWithHashSelect,
    });
  }

  private getExistingOrder(
    existing: OrderWithHash,
    requestHash: string,
  ): OrderResponse {
    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'This idempotency key was already used for a different order.',
      );
    }
    const { requestHash: _requestHash, ...safeOrder } = existing;
    return this.toOrderResponse(safeOrder);
  }

  private toOrderResponse(order: SafeOrder): OrderResponse {
    const paymentAmount =
      order.paymentOption === null
        ? null
        : order.paymentOption === 'DEPOSIT'
          ? new Prisma.Decimal(order.total)
              .dividedBy(2)
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
              .toFixed(2)
          : new Prisma.Decimal(order.total).toFixed(2);

    return {
      ...order,
      status: order.status === 'CONFIRMED' ? 'PENDING' : order.status,
      paymentAmount,
    };
  }

  private validateInput(input: CreateOrderDto): void {
    if (
      !Array.isArray(input?.items) ||
      input.items.length === 0 ||
      input.items.length > MAX_ORDER_LINES
    ) {
      throw new BadRequestException(
        `An order must contain between 1 and ${MAX_ORDER_LINES} items.`,
      );
    }

    const variantIds = new Set<string>();
    for (const item of input.items) {
      if (
        typeof item?.variantId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          item.variantId,
        ) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > MAX_LINE_QUANTITY
      ) {
        throw new BadRequestException('Order items are invalid.');
      }
      if (variantIds.has(item.variantId)) {
        throw new BadRequestException(
          'An order cannot contain duplicate variant IDs.',
        );
      }
      variantIds.add(item.variantId);
    }
  }

  private validateIdempotencyKey(idempotencyKey?: string): void {
    if (
      idempotencyKey !== undefined &&
      (typeof idempotencyKey !== 'string' ||
        idempotencyKey.trim().length === 0 ||
        idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH)
    ) {
      throw new BadRequestException('The idempotency key is invalid.');
    }
  }

  private hashRequest(items: CreateOrderDto['items']): string {
    return createHash('sha256')
      .update(
        JSON.stringify(
          items.map(({ variantId, quantity }) => ({ variantId, quantity })),
        ),
      )
      .digest('hex');
  }

  private hasPrismaErrorCode(error: unknown, code: 'P2002' | 'P2034'): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === code
    );
  }
}
