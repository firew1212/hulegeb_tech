import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CatalogService } from './catalog.service.js';

function createCatalogService(
  productFindMany = vi.fn(),
  productCount = vi.fn(),
) {
  const transaction = vi.fn(async (operations: Promise<unknown>[]) =>
    Promise.all(operations),
  );
  const productFindFirst = vi.fn();
  const prisma = {
    $transaction: transaction,
    product: {
      findMany: productFindMany,
      count: productCount,
      findFirst: productFindFirst,
    },
  } as unknown as PrismaService;
  return {
    service: new CatalogService(prisma),
    transaction,
    productFindFirst,
  };
}

describe('CatalogService public product listings', () => {
  it('lists only eligible in-stock products with bounded pagination and public fields', async () => {
    const products = [{ id: 'public-product' }];
    const findMany = vi.fn().mockResolvedValue(products);
    const count = vi.fn().mockResolvedValue(21);
    const { service, transaction } = createCatalogService(findMany, count);

    await expect(
      service.listPublicProducts({ page: 2, limit: 10 }),
    ).resolves.toEqual({
      data: products,
      page: 2,
      limit: 10,
      total: 21,
      totalPages: 3,
    });

    const publicWhere = {
      status: 'APPROVED',
      category: { isActive: true },
      seller: { status: 'APPROVED', user: { status: 'ACTIVE' } },
      variants: { some: { isActive: true, stockQuantity: { gt: 0 } } },
    };
    expect(findMany).toHaveBeenCalledWith({
      where: publicWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: 10,
      take: 10,
      select: expect.objectContaining({
        titleEn: true,
        titleAm: true,
        descriptionEn: true,
        descriptionAm: true,
        category: expect.objectContaining({
          select: expect.objectContaining({
            nameEn: true,
            nameAm: true,
          }),
        }),
        variants: expect.objectContaining({
          where: { isActive: true, stockQuantity: { gt: 0 } },
          select: expect.objectContaining({
            price: true,
            stockQuantity: true,
          }),
        }),
        images: expect.any(Object),
      }),
    });
    expect(count).toHaveBeenCalledWith({ where: publicWhere });
    expect(transaction).toHaveBeenCalledOnce();

    const selection = findMany.mock.calls[0][0].select;
    expect(selection).not.toHaveProperty('status');
    expect(selection).not.toHaveProperty('seller');
    expect(selection.variants.select).not.toHaveProperty('sku');
  });

  it('applies the same eligibility rules to public product details', async () => {
    const product = { id: 'public-product', titleEn: 'Product' };
    const { service, productFindFirst } = createCatalogService();
    productFindFirst.mockResolvedValue(product);

    await expect(service.getPublicProduct('public-product')).resolves.toEqual(
      product,
    );
    expect(productFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'public-product',
        status: 'APPROVED',
        category: { isActive: true },
        seller: { status: 'APPROVED', user: { status: 'ACTIVE' } },
        variants: { some: { isActive: true, stockQuantity: { gt: 0 } } },
      },
      select: expect.objectContaining({
        titleEn: true,
        titleAm: true,
        category: expect.any(Object),
        variants: expect.any(Object),
        images: expect.any(Object),
      }),
    });
  });

  it('returns the same not found response for any product not publicly eligible', async () => {
    const { service, productFindFirst } = createCatalogService();
    productFindFirst.mockResolvedValue(null);

    await expect(
      service.getPublicProduct('hidden-product'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(productFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'APPROVED',
          category: { isActive: true },
          seller: { status: 'APPROVED', user: { status: 'ACTIVE' } },
          variants: { some: { isActive: true, stockQuantity: { gt: 0 } } },
        }),
      }),
    );
  });
});
