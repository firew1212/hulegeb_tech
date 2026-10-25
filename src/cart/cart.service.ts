import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrdersService } from '../orders/orders.service.js';

const MAX_CART_LINES = 20;
const MAX_LINE_QUANTITY = 10;

const cartSelect = {
  id: true,
  items: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      variantId: true,
      quantity: true,
      variant: {
        select: {
          name: true,
          price: true,
          stockQuantity: true,
          isActive: true,
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
        },
      },
    },
  },
} satisfies Prisma.CartSelect;

type CartWithItems = Prisma.CartGetPayload<{ select: typeof cartSelect }>;
type CartVariant = CartWithItems['items'][number]['variant'];

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  async getCart(buyerId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { buyerId },
      select: cartSelect,
    });
    return this.toCartResponse(cart);
  }

  async addItem(buyerId: string, variantId: string, quantity: number) {
    this.validateQuantity(quantity);

    await this.prisma.$transaction(
      async (tx) => {
        const variant = await tx.productVariant.findUnique({
          where: { id: variantId },
          select: {
            ...cartSelect.items.select.variant.select,
          },
        });
        if (!variant || !this.isEligible(variant)) {
          throw new BadRequestException(
            'The selected product variant is unavailable.',
          );
        }

        const cart = await tx.cart.upsert({
          where: { buyerId },
          create: { buyerId },
          update: {},
          select: { id: true },
        });
        const existing = await tx.cartItem.findUnique({
          where: {
            cartId_variantId: { cartId: cart.id, variantId },
          },
          select: { quantity: true },
        });
        const nextQuantity = (existing?.quantity ?? 0) + quantity;
        this.validateQuantity(nextQuantity);
        if (variant.stockQuantity < nextQuantity) {
          throw new BadRequestException(
            'The selected product variant does not have enough stock.',
          );
        }
        if (!existing) {
          const lineCount = await tx.cartItem.count({
            where: { cartId: cart.id },
          });
          if (lineCount >= MAX_CART_LINES) {
            throw new BadRequestException(
              `A cart cannot contain more than ${MAX_CART_LINES} items.`,
            );
          }
        }

        await tx.cartItem.upsert({
          where: {
            cartId_variantId: { cartId: cart.id, variantId },
          },
          create: { cartId: cart.id, variantId, quantity: nextQuantity },
          update: { quantity: nextQuantity },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.getCart(buyerId);
  }

  async updateItem(buyerId: string, variantId: string, quantity: number) {
    this.validateQuantity(quantity);

    await this.prisma.$transaction(
      async (tx) => {
        const cart = await tx.cart.findUnique({
          where: { buyerId },
          select: { id: true },
        });
        if (!cart) {
          throw new NotFoundException('Cart item was not found.');
        }
        const item = await tx.cartItem.findUnique({
          where: {
            cartId_variantId: { cartId: cart.id, variantId },
          },
          select: { id: true },
        });
        if (!item) {
          throw new NotFoundException('Cart item was not found.');
        }

        const variant = await tx.productVariant.findUnique({
          where: { id: variantId },
          select: {
            ...cartSelect.items.select.variant.select,
          },
        });
        if (!variant || !this.isEligible(variant)) {
          throw new BadRequestException(
            'The selected product variant is unavailable.',
          );
        }
        if (variant.stockQuantity < quantity) {
          throw new BadRequestException(
            'The selected product variant does not have enough stock.',
          );
        }

        await tx.cartItem.update({
          where: { id: item.id },
          data: { quantity },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.getCart(buyerId);
  }

  async removeItem(buyerId: string, variantId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { buyerId },
      select: { id: true },
    });
    if (cart) {
      await this.prisma.cartItem.deleteMany({
        where: { cartId: cart.id, variantId },
      });
    }
    return this.getCart(buyerId);
  }

  async checkout(buyerId: string, idempotencyKey: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { buyerId },
      select: cartSelect,
    });
    if (!cart || cart.items.length === 0) {
      const existingOrder = await this.orders.getBuyerOrderByIdempotencyKey(
        buyerId,
        idempotencyKey,
      );
      if (existingOrder) {
        return existingOrder;
      }
      throw new BadRequestException('The cart is empty.');
    }

    const order = await this.orders.createOrder(
      buyerId,
      {
        items: cart.items.map(({ variantId, quantity }) => ({
          variantId,
          quantity,
        })),
      },
      idempotencyKey,
    );

    await this.prisma.cartItem.deleteMany({
      where: {
        cartId: cart.id,
        OR: cart.items.map(({ variantId, quantity }) => ({
          variantId,
          quantity,
        })),
      },
    });

    return order;
  }

  private toCartResponse(cart: CartWithItems | null) {
    const items = (cart?.items ?? []).map((item) => {
      const unitPrice = new Prisma.Decimal(item.variant.price);
      return {
        variantId: item.variantId,
        quantity: item.quantity,
        productId: item.variant.product.id,
        productNameEn: item.variant.product.titleEn,
        productNameAm: item.variant.product.titleAm,
        variantName: item.variant.name,
        unitPrice: unitPrice.toFixed(2),
        lineTotal: unitPrice.mul(item.quantity).toFixed(2),
        stockQuantity: item.variant.stockQuantity,
        isAvailable:
          this.isEligible(item.variant) &&
          item.variant.stockQuantity >= item.quantity,
      };
    });
    const total = items.reduce(
      (sum, item) => sum.plus(item.lineTotal),
      new Prisma.Decimal(0),
    );

    return { items, total: total.toFixed(2) };
  }

  private isEligible(variant: CartVariant): boolean {
    return (
      variant.isActive &&
      variant.stockQuantity > 0 &&
      variant.product.status === 'APPROVED' &&
      variant.product.category.isActive &&
      variant.product.seller.status === 'APPROVED' &&
      variant.product.seller.user.status === 'ACTIVE'
    );
  }

  private validateQuantity(quantity: number): void {
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_LINE_QUANTITY
    ) {
      throw new BadRequestException(
        `Cart item quantity must be between 1 and ${MAX_LINE_QUANTITY}.`,
      );
    }
  }
}
