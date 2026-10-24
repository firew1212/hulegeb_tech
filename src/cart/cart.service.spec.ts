import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { OrdersService } from '../orders/orders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CartService } from './cart.service.js';

const buyerId = 'buyer-id';
const variantId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const cartId = 'cart-id';

function eligibleVariant(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Large / Blue',
    price: new Prisma.Decimal('12.50'),
    stockQuantity: 10,
    isActive: true,
    product: {
      id: 'product-id',
      titleEn: 'Linen shirt',
      titleAm: 'የበፍታ ሸሚዝ',
      status: 'APPROVED',
      category: { isActive: true },
      seller: { status: 'APPROVED', user: { status: 'ACTIVE' } },
    },
    ...overrides,
  };
}

function cartWithItems(
  items: {
    quantity: number;
    variant?: ReturnType<typeof eligibleVariant>;
  }[] = [],
) {
  return {
    id: cartId,
    items: items.map(({ quantity, variant = eligibleVariant() }) => ({
      variantId,
      quantity,
      variant,
    })),
  };
}

function createContext(options?: {
  variant?: ReturnType<typeof eligibleVariant> | null;
  existingQuantity?: number | null;
  cart?: ReturnType<typeof cartWithItems> | null;
}) {
  const variant =
    options?.variant === undefined ? eligibleVariant() : options.variant;
  const cart = options?.cart === undefined ? cartWithItems() : options.cart;
  const tx = {
    productVariant: {
      findUnique: vi.fn().mockResolvedValue(variant),
    },
    cart: {
      upsert: vi.fn().mockResolvedValue({ id: cartId }),
      findUnique: vi.fn().mockResolvedValue({ id: cartId }),
    },
    cartItem: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          options?.existingQuantity == null
            ? null
            : { id: 'cart-item-id', quantity: options.existingQuantity },
        ),
      count: vi.fn().mockResolvedValue(0),
      upsert: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
  const deleteCartItems = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    $transaction: vi.fn(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    ),
    cart: {
      findUnique: vi.fn().mockResolvedValue(cart),
    },
    cartItem: { deleteMany: deleteCartItems },
  } as unknown as PrismaService;
  const createOrder = vi.fn().mockResolvedValue({ id: 'order-id' });
  const orders = {
    createOrder,
    getBuyerOrderByIdempotencyKey: vi.fn().mockResolvedValue(null),
  } as unknown as OrdersService;

  return {
    service: new CartService(prisma, orders),
    prisma,
    tx,
    createOrder,
    deleteCartItems,
  };
}

describe('CartService', () => {
  it('adds quantities to an existing buyer-owned cart line', async () => {
    const context = createContext({
      existingQuantity: 2,
      cart: cartWithItems([{ quantity: 5 }]),
    });

    await context.service.addItem(buyerId, variantId, 3);

    expect(context.tx.cartItem.upsert).toHaveBeenCalledWith({
      where: { cartId_variantId: { cartId, variantId } },
      create: { cartId, variantId, quantity: 5 },
      update: { quantity: 5 },
    });
  });

  it('rejects unavailable variants and quantities above available stock', async () => {
    const unavailable = createContext({
      variant: eligibleVariant({
        product: {
          ...eligibleVariant().product,
          status: 'UNAVAILABLE',
        },
      }),
    });
    await expect(
      unavailable.service.addItem(buyerId, variantId, 1),
    ).rejects.toBeInstanceOf(BadRequestException);

    const insufficient = createContext({
      variant: eligibleVariant({ stockQuantity: 1 }),
    });
    await expect(
      insufficient.service.addItem(buyerId, variantId, 2),
    ).rejects.toThrow('does not have enough stock');
  });

  it('returns trusted current pricing and availability in the cart view', async () => {
    const context = createContext({
      cart: cartWithItems([{ quantity: 2 }]),
    });

    await expect(context.service.getCart(buyerId)).resolves.toMatchObject({
      items: [
        {
          variantId,
          quantity: 2,
          unitPrice: '12.50',
          lineTotal: '25.00',
          isAvailable: true,
        },
      ],
      total: '25.00',
    });
  });

  it('creates checkout from stored cart quantities and clears only the checked-out snapshot', async () => {
    const context = createContext({
      cart: cartWithItems([{ quantity: 2 }]),
    });
    const result = await context.service.checkout(buyerId, 'checkout-key');

    expect(context.createOrder).toHaveBeenCalledWith(
      buyerId,
      { items: [{ variantId, quantity: 2 }] },
      'checkout-key',
    );
    expect(context.deleteCartItems).toHaveBeenCalledWith({
      where: {
        cartId,
        OR: [{ variantId, quantity: 2 }],
      },
    });
    expect(result).toEqual({ id: 'order-id' });
  });
});
