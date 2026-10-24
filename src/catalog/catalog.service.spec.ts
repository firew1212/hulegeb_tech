import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { RequestUser } from '../authorization/authorization.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CatalogService } from './catalog.service.js';

const sellerUser: RequestUser = {
  id: 'seller-user-id',
  roles: ['SELLER'],
  status: 'ACTIVE',
  sellerStatus: 'APPROVED',
};

function createCatalogService(prisma: object) {
  return new CatalogService(prisma as PrismaService);
}

function sellerProfileMock(status = 'APPROVED') {
  return {
    findUnique: vi.fn().mockResolvedValue({ id: 'seller-profile-id', status }),
  };
}

function createProductModerationService(
  updatedCount = 1,
  resultStatus: 'APPROVED' | 'REJECTED' = 'APPROVED',
) {
  const productFindUnique = vi.fn().mockResolvedValue({
    id: 'product-id',
    slug: 'sample-product',
    titleEn: 'Sample Product',
    titleAm: 'የሙከራ ምርት',
    descriptionEn: null,
    descriptionAm: null,
    status: 'PENDING_APPROVAL',
    category: { isActive: true },
    seller: {
      status: 'APPROVED',
      user: { id: 'seller-owner-id' },
    },
  });
  const productUpdateMany = vi.fn().mockResolvedValue({ count: updatedCount });
  const productFindUniqueOrThrow = vi.fn().mockResolvedValue({
    id: 'product-id',
    status: resultStatus,
  });
  const notificationCreate = vi.fn().mockResolvedValue({});
  const transactionClient = {
    product: {
      findUnique: productFindUnique,
      updateMany: productUpdateMany,
      findUniqueOrThrow: productFindUniqueOrThrow,
    },
    notification: { create: notificationCreate },
  };
  const transaction = vi.fn(
    (callback: (tx: typeof transactionClient) => unknown) =>
      callback(transactionClient),
  );

  return {
    service: createCatalogService({ $transaction: transaction }),
    notificationCreate,
    productFindUnique,
    productUpdateMany,
  };
}

describe('CatalogService', () => {
  it('lists all categories, including inactive records, in hierarchy order', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'root', isActive: false },
      { id: 'child', parentId: 'root', isActive: true },
    ]);
    const service = createCatalogService({ category: { findMany } });

    await expect(service.listAllCategories()).resolves.toHaveLength(2);
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { nameEn: 'asc' }],
      include: {
        parent: {
          select: { id: true, slug: true, nameEn: true, nameAm: true },
        },
      },
    });
  });

  it('creates a category with bilingual names and its existing parent', async () => {
    const categoryCreate = vi.fn().mockResolvedValue({ id: 'category-id' });
    const categoryFindUnique = vi.fn().mockResolvedValue({ id: 'parent-id' });
    const service = createCatalogService({
      category: { create: categoryCreate, findUnique: categoryFindUnique },
    });

    await expect(
      service.createCategory({
        slug: 'sample-category',
        nameEn: ' Sample Category ',
        nameAm: ' የሙከራ ምድብ ',
        parentId: 'parent-id',
      }),
    ).resolves.toEqual({ id: 'category-id' });
    expect(categoryCreate).toHaveBeenCalledWith({
      data: {
        slug: 'sample-category',
        nameEn: 'Sample Category',
        nameAm: 'የሙከራ ምድብ',
        descriptionEn: undefined,
        descriptionAm: undefined,
        parentId: 'parent-id',
        sortOrder: undefined,
      },
    });
  });

  it('rejects a category whose parent does not exist', async () => {
    const categoryCreate = vi.fn();
    const service = createCatalogService({
      category: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: categoryCreate,
      },
    });

    await expect(
      service.createCategory({
        slug: 'sample-category',
        nameEn: 'Sample Category',
        nameAm: 'የሙከራ ምድብ',
        parentId: 'missing-parent',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(categoryCreate).not.toHaveBeenCalled();
  });

  it('maps duplicate category slugs to a conflict', async () => {
    const service = createCatalogService({
      category: {
        create: vi.fn().mockRejectedValue({ code: 'P2002' }),
      },
    });

    await expect(
      service.createCategory({
        slug: 'duplicate',
        nameEn: 'Duplicate',
        nameAm: 'ድግግሞሽ',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates bilingual fields, sort order, and parent after rejecting cycles', async () => {
    const categoryUpdate = vi.fn().mockResolvedValue({ id: 'category-id' });
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'category-id', parentId: null })
      .mockResolvedValueOnce({ parentId: null });
    const service = createCatalogService({
      category: { findUnique, update: categoryUpdate },
    });

    await expect(
      service.updateCategory('category-id', {
        nameEn: 'Updated',
        nameAm: 'ተዘምኗል',
        descriptionEn: ' Updated description ',
        parentId: 'new-parent-id',
        sortOrder: 3,
      }),
    ).resolves.toEqual({ id: 'category-id' });
    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'category-id' },
      data: {
        slug: undefined,
        nameEn: 'Updated',
        nameAm: 'ተዘምኗል',
        descriptionEn: 'Updated description',
        descriptionAm: undefined,
        parentId: 'new-parent-id',
        sortOrder: 3,
      },
    });
  });

  it('rejects a parent change that would create a cycle', async () => {
    const update = vi.fn();
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'category-id', parentId: null })
      .mockResolvedValueOnce({ parentId: 'category-id' });
    const service = createCatalogService({
      category: { findUnique, update },
    });

    await expect(
      service.updateCategory('category-id', { parentId: 'descendant-id' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('allows clearing a parent relationship', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'category-id' });
    const service = createCatalogService({
      category: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'category-id',
          parentId: 'old-parent',
        }),
        update,
      },
    });

    await service.updateCategory('category-id', { parentId: null });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'category-id' },
      data: expect.objectContaining({ parentId: null }),
    });
  });

  it('refuses to deactivate categories referenced by products or children', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue({ id: 'category-id' });
    const service = createCatalogService({
      category: {
        updateMany,
        findUnique,
      },
    });

    await expect(
      service.deactivateCategory('category-id'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'category-id',
        products: { none: {} },
        children: { none: {} },
      },
      data: { isActive: false },
    });
  });

  it('deactivates an unused leaf category without deleting it', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue({
      id: 'category-id',
      isActive: false,
    });
    const service = createCatalogService({
      category: {
        updateMany,
        findUniqueOrThrow,
      },
    });

    await expect(
      service.deactivateCategory('category-id'),
    ).resolves.toMatchObject({ isActive: false });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'category-id',
        products: { none: {} },
        children: { none: {} },
      },
      data: { isActive: false },
    });
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'category-id' },
    });
  });

  it('returns active categories in hierarchy-preserving records', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'parent-id',
        parentId: null,
        children: [{ id: 'child-id', parentId: 'parent-id' }],
      },
    ]);
    const service = createCatalogService({ category: { findMany } });

    await expect(service.listActiveCategories()).resolves.toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      include: {
        children: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
        },
      },
    });
  });

  it('notifies the seller when a pending product is approved', async () => {
    const context = createProductModerationService(1, 'APPROVED');

    await expect(
      context.service.approveProduct('product-id'),
    ).resolves.toMatchObject({ id: 'product-id', status: 'APPROVED' });
    expect(context.notificationCreate).toHaveBeenCalledWith({
      data: {
        type: 'PRODUCT_APPROVED',
        userId: 'seller-owner-id',
        resourceId: 'product-id',
      },
    });
    expect(context.productFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          seller: {
            select: { status: true, user: { select: { id: true } } },
          },
        }),
      }),
    );
  });

  it('does not notify when product approval loses the conditional update', async () => {
    const context = createProductModerationService(0);

    await expect(
      context.service.approveProduct('product-id'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(context.notificationCreate).not.toHaveBeenCalled();
  });

  it('notifies the seller when a pending product is rejected', async () => {
    const context = createProductModerationService(1, 'REJECTED');

    await expect(
      context.service.rejectProduct('product-id'),
    ).resolves.toMatchObject({ id: 'product-id', status: 'REJECTED' });
    expect(context.notificationCreate).toHaveBeenCalledWith({
      data: {
        type: 'PRODUCT_REJECTED',
        userId: 'seller-owner-id',
        resourceId: 'product-id',
      },
    });
  });

  it('does not notify when product rejection loses the conditional update', async () => {
    const context = createProductModerationService(0, 'REJECTED');

    await expect(
      context.service.rejectProduct('product-id'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(context.notificationCreate).not.toHaveBeenCalled();
  });

  it('creates a product owned by the authenticated seller in pending approval', async () => {
    const product = { id: 'product-id', status: 'PENDING_APPROVAL' };
    const productCreate = vi.fn().mockResolvedValue(product);
    const categoryFindFirst = vi.fn().mockResolvedValue({ id: 'category-id' });
    const service = createCatalogService({
      sellerProfile: sellerProfileMock(),
      category: { findFirst: categoryFindFirst },
      product: { create: productCreate },
    });

    await expect(
      service.createProduct(sellerUser, {
        categoryId: 'category-id',
        slug: 'sample-product',
        titleEn: 'Sample Product',
        titleAm: 'የሙከራ ምርት',
      }),
    ).resolves.toEqual(product);
    expect(productCreate).toHaveBeenCalledWith({
      data: {
        categoryId: 'category-id',
        slug: 'sample-product',
        titleEn: 'Sample Product',
        titleAm: 'የሙከራ ምርት',
        sellerId: 'seller-profile-id',
        status: 'PENDING_APPROVAL',
      },
      include: expect.any(Object),
    });
  });

  it('refuses catalog writes for a seller profile that is not approved', async () => {
    const productCreate = vi.fn();
    const service = createCatalogService({
      sellerProfile: sellerProfileMock('PENDING_APPROVAL'),
      product: { create: productCreate },
    });

    await expect(
      service.createProduct(sellerUser, {
        categoryId: 'category-id',
        slug: 'sample-product',
        titleEn: 'Sample Product',
        titleAm: 'የሙከራ ምርት',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(productCreate).not.toHaveBeenCalled();
  });

  it('rejects product creation with an inactive or missing category', async () => {
    const productCreate = vi.fn();
    const service = createCatalogService({
      sellerProfile: sellerProfileMock(),
      category: { findFirst: vi.fn().mockResolvedValue(null) },
      product: { create: productCreate },
    });

    await expect(
      service.createProduct(sellerUser, {
        categoryId: 'inactive-category-id',
        slug: 'sample-product',
        titleEn: 'Sample Product',
        titleAm: 'የሙከራ ምርት',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(productCreate).not.toHaveBeenCalled();
  });

  it('requires an active category on product updates and resets status for moderation', async () => {
    const updatedProduct = { id: 'product-id', status: 'PENDING_APPROVAL' };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValue(updatedProduct);
    const categoryFindFirst = vi.fn().mockResolvedValue({ id: 'category-id' });
    const service = createCatalogService({
      sellerProfile: sellerProfileMock(),
      category: { findFirst: categoryFindFirst },
      product: { updateMany, findFirst },
    });

    await expect(
      service.updateProduct(sellerUser, 'product-id', {
        categoryId: 'category-id',
        titleEn: 'Updated title',
      }),
    ).resolves.toEqual(updatedProduct);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'product-id', sellerId: 'seller-profile-id' },
      data: {
        categoryId: 'category-id',
        titleEn: 'Updated title',
        status: 'PENDING_APPROVAL',
      },
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'product-id', sellerId: 'seller-profile-id' },
      }),
    );
  });

  it('rejects empty product updates', async () => {
    const service = createCatalogService({
      sellerProfile: sellerProfileMock(),
      product: { updateMany: vi.fn() },
    });

    await expect(
      service.updateProduct(sellerUser, 'product-id', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not update a product owned by another seller', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const service = createCatalogService({
      sellerProfile: sellerProfileMock(),
      product: { updateMany, findFirst: vi.fn() },
    });

    await expect(
      service.updateProduct(sellerUser, 'foreign-product-id', {
        titleEn: 'Attempted update',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'foreign-product-id',
        sellerId: 'seller-profile-id',
      },
      data: {
        titleEn: 'Attempted update',
        status: 'PENDING_APPROVAL',
      },
    });
  });

  it('resets product status to pending when a seller changes variant stock', async () => {
    const reservationCount = vi.fn().mockResolvedValue(0);
    const transaction = vi.fn(
      (callback: (tx: object) => unknown, _options?: unknown) =>
        callback({
          orderStockReservation: { count: reservationCount },
          productVariant: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              id: 'variant-id',
              stockQuantity: 12,
            }),
          },
          product: { update: vi.fn().mockResolvedValue({}) },
        }),
    );
    const productFindFirst = vi.fn().mockResolvedValue({ id: 'product-id' });
    const service = createCatalogService({
      sellerProfile: sellerProfileMock(),
      product: { findFirst: productFindFirst },
      $transaction: transaction,
    });

    await expect(
      service.updateVariant(sellerUser, 'product-id', 'variant-id', {
        stockQuantity: 12,
      }),
    ).resolves.toMatchObject({ stockQuantity: 12 });
    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'Serializable',
    });
    expect(reservationCount).toHaveBeenCalledWith({
      where: { variantId: 'variant-id', releasedAt: null },
    });
    expect(productFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'product-id', sellerId: 'seller-profile-id' },
      }),
    );
  });

  it('rejects stock edits while the variant has active order reservations', async () => {
    const variantUpdateMany = vi.fn();
    const productUpdate = vi.fn();
    const reservationCount = vi.fn().mockResolvedValue(1);
    const transaction = vi.fn((callback: (tx: object) => unknown) =>
      callback({
        orderStockReservation: { count: reservationCount },
        productVariant: { updateMany: variantUpdateMany },
        product: { update: productUpdate },
      }),
    );
    const service = createCatalogService({
      sellerProfile: sellerProfileMock(),
      product: { findFirst: vi.fn().mockResolvedValue({ id: 'product-id' }) },
      $transaction: transaction,
    });

    await expect(
      service.updateVariant(sellerUser, 'product-id', 'variant-id', {
        stockQuantity: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(reservationCount).toHaveBeenCalledWith({
      where: { variantId: 'variant-id', releasedAt: null },
    });
    expect(variantUpdateMany).not.toHaveBeenCalled();
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it('does not block non-stock variant edits when active reservations exist', async () => {
    const reservationCount = vi.fn();
    const variantUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue({
      id: 'variant-id',
      name: 'Updated name',
    });
    const transaction = vi.fn((callback: (tx: object) => unknown) =>
      callback({
        orderStockReservation: { count: reservationCount },
        productVariant: { updateMany: variantUpdateMany, findUniqueOrThrow },
        product: { update: vi.fn().mockResolvedValue({}) },
      }),
    );
    const service = createCatalogService({
      sellerProfile: sellerProfileMock(),
      product: { findFirst: vi.fn().mockResolvedValue({ id: 'product-id' }) },
      $transaction: transaction,
    });

    await expect(
      service.updateVariant(sellerUser, 'product-id', 'variant-id', {
        name: 'Updated name',
      }),
    ).resolves.toMatchObject({ name: 'Updated name' });

    expect(reservationCount).not.toHaveBeenCalled();
    expect(variantUpdateMany).toHaveBeenCalledOnce();
  });

  it('reports a concurrent stock reservation conflict without updating the variant', async () => {
    const transaction = vi.fn().mockRejectedValue({ code: 'P2034' });
    const productFindFirst = vi.fn().mockResolvedValue({ id: 'product-id' });
    const service = createCatalogService({
      sellerProfile: sellerProfileMock(),
      product: { findFirst: productFindFirst },
      $transaction: transaction,
    });

    await expect(
      service.updateVariant(sellerUser, 'product-id', 'variant-id', {
        stockQuantity: 12,
      }),
    ).rejects.toThrow('Stock changed concurrently.');
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('rejects variant edits when the variant is not part of the seller product', async () => {
    const variantUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const productUpdate = vi.fn();
    const transaction = vi.fn((callback: (tx: object) => unknown) =>
      callback({
        orderStockReservation: { count: vi.fn().mockResolvedValue(0) },
        productVariant: { updateMany: variantUpdateMany },
        product: { update: productUpdate },
      }),
    );
    const service = createCatalogService({
      sellerProfile: sellerProfileMock(),
      product: { findFirst: vi.fn().mockResolvedValue({ id: 'product-id' }) },
      $transaction: transaction,
    });

    await expect(
      service.updateVariant(sellerUser, 'product-id', 'foreign-variant-id', {
        stockQuantity: 4,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(variantUpdateMany).toHaveBeenCalledWith({
      where: { id: 'foreign-variant-id', productId: 'product-id' },
      data: {
        name: undefined,
        attributes: undefined,
        price: undefined,
        stockQuantity: 4,
        isActive: undefined,
      },
    });
    expect(productUpdate).not.toHaveBeenCalled();
  });
});
