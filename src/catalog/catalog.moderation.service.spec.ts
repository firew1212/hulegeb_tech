import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CatalogService } from './catalog.service.js';

function createCatalogService(
  transactionClient: object,
  productFindMany = vi.fn(),
) {
  const transaction = vi.fn(
    (callback: (tx: typeof transactionClient) => unknown) =>
      callback(transactionClient),
  );
  const prisma = {
    $transaction: transaction,
    product: { findMany: productFindMany },
  } as unknown as PrismaService;

  return { service: new CatalogService(prisma), transaction, productFindMany };
}

function pendingProduct(overrides: object = {}) {
  return {
    id: 'product-id',
    slug: 'valid-product',
    titleEn: 'Product',
    titleAm: 'ምርት',
    status: 'PENDING_APPROVAL',
    category: { isActive: true },
    seller: { status: 'APPROVED' },
    ...overrides,
  };
}

describe('CatalogService product moderation', () => {
  it('lists only pending products with category, variants, images, and seller review details', async () => {
    const products = [{ id: 'pending-product' }];
    const findMany = vi.fn().mockResolvedValue(products);
    const { service } = createCatalogService({}, findMany);

    await expect(service.listPendingProducts()).resolves.toEqual(products);
    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING_APPROVAL' },
      orderBy: { createdAt: 'asc' },
      include: {
        category: {
          select: { id: true, slug: true, nameEn: true, nameAm: true },
        },
        variants: { orderBy: { createdAt: 'asc' } },
        images: { orderBy: { sortOrder: 'asc' } },
        seller: {
          select: {
            id: true,
            displayName: true,
            legalName: true,
            status: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
    });
  });

  it('approves a validated pending product using a conditional status transition', async () => {
    const findUnique = vi.fn().mockResolvedValue(pendingProduct());
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue({
      ...pendingProduct(),
      status: 'APPROVED',
    });
    const { service, transaction } = createCatalogService({
      product: { findUnique, updateMany, findUniqueOrThrow },
    });

    await expect(service.approveProduct('product-id')).resolves.toMatchObject({
      status: 'APPROVED',
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'product-id', status: 'PENDING_APPROVAL' },
      data: { status: 'APPROVED' },
    });
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'product-id' },
      include: expect.objectContaining({
        seller: expect.any(Object),
        category: expect.any(Object),
      }),
    });
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('returns not found when approval targets a missing product', async () => {
    const updateMany = vi.fn();
    const { service } = createCatalogService({
      product: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany,
      },
    });

    await expect(service.approveProduct('missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['APPROVED', 'already approved'],
    ['UNAVAILABLE', 'unavailable'],
    ['REJECTED', 'rejected'],
    ['DRAFT', 'draft'],
  ])('does not approve a product in %s status', async (status) => {
    const updateMany = vi.fn();
    const { service } = createCatalogService({
      product: {
        findUnique: vi.fn().mockResolvedValue(pendingProduct({ status })),
        updateMany,
      },
    });

    await expect(service.approveProduct('product-id')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['Invalid Product', 'Product', 'ምርት'],
    ['valid-product', '  ', 'ምርት'],
    ['valid-product', 'Product', '  '],
  ])(
    'rejects approval when persisted required product fields are invalid',
    async (slug, titleEn, titleAm) => {
      const updateMany = vi.fn();
      const { service } = createCatalogService({
        product: {
          findUnique: vi
            .fn()
            .mockResolvedValue(pendingProduct({ slug, titleEn, titleAm })),
          updateMany,
        },
      });

      await expect(service.approveProduct('product-id')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(updateMany).not.toHaveBeenCalled();
    },
  );

  it('does not approve a product in an inactive category', async () => {
    const updateMany = vi.fn();
    const { service } = createCatalogService({
      product: {
        findUnique: vi
          .fn()
          .mockResolvedValue(pendingProduct({ category: { isActive: false } })),
        updateMany,
      },
    });

    await expect(service.approveProduct('product-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not approve a product when seller approval is no longer active', async () => {
    const updateMany = vi.fn();
    const { service } = createCatalogService({
      product: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            pendingProduct({ seller: { status: 'SUSPENDED' } }),
          ),
        updateMany,
      },
    });

    await expect(service.approveProduct('product-id')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('returns a conflict when product status changes during approval', async () => {
    const { service } = createCatalogService({
      product: {
        findUnique: vi.fn().mockResolvedValue(pendingProduct()),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });

    await expect(service.approveProduct('product-id')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a pending product with only the existing status field', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 'product-id',
      status: 'PENDING_APPROVAL',
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue({
      id: 'product-id',
      status: 'REJECTED',
    });
    const { service } = createCatalogService({
      product: { findUnique, updateMany, findUniqueOrThrow },
    });

    await expect(service.rejectProduct('product-id')).resolves.toMatchObject({
      status: 'REJECTED',
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'product-id', status: 'PENDING_APPROVAL' },
      data: { status: 'REJECTED' },
    });
  });

  it('returns not found when rejection targets a missing product', async () => {
    const updateMany = vi.fn();
    const { service } = createCatalogService({
      product: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany,
      },
    });

    await expect(service.rejectProduct('missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each(['APPROVED', 'UNAVAILABLE', 'REJECTED'])(
    'does not reject a product in %s status',
    async (status) => {
      const updateMany = vi.fn();
      const { service } = createCatalogService({
        product: {
          findUnique: vi.fn().mockResolvedValue({ id: 'product-id', status }),
          updateMany,
        },
      });

      await expect(service.rejectProduct('product-id')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(updateMany).not.toHaveBeenCalled();
    },
  );
});
