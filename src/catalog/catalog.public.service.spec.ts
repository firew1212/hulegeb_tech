import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CatalogService } from './catalog.service.js';

function createCatalogService(
  productFindMany = vi.fn().mockResolvedValue([]),
  productCount = vi.fn().mockResolvedValue(0),
  productFindFirst = vi.fn(),
  queryRaw = vi.fn().mockResolvedValue([]),
) {
  const analyticsUpsert = vi.fn().mockResolvedValue({});
  let prisma: PrismaService;
  const transaction = vi.fn(
    (
      operations:
        Promise<unknown>[] | ((tx: PrismaService) => Promise<unknown>),
    ) =>
      typeof operations === 'function'
        ? operations(prisma)
        : Promise.all(operations),
  );
  prisma = {
    $transaction: transaction,
    $queryRaw: queryRaw,
    product: {
      findMany: productFindMany,
      count: productCount,
      findFirst: productFindFirst,
    },
    searchTermAnalytics: { upsert: analyticsUpsert },
  } as unknown as PrismaService;
  return {
    service: new CatalogService(prisma),
    transaction,
    queryRaw,
    analyticsUpsert,
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
      service.listPublicProducts({ page: 2, limit: 10, sort: 'newest' }),
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

  it('filters public results and records normalized terms with aggregate counts', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(3);
    const { service, analyticsUpsert } = createCatalogService(findMany, count);

    await expect(
      service.listPublicProducts({
        page: 1,
        limit: 20,
        q: '  Linen   shirt ',
        categoryId: 'category-id',
        subcategoryId: 'subcategory-id',
        minPrice: 10,
        maxPrice: 30,
        condition: 'USED',
        sort: 'newest',
      }),
    ).resolves.toMatchObject({ data: [], total: 3, totalPages: 1 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'APPROVED',
          category: {
            isActive: true,
            id: 'subcategory-id',
            parentId: 'category-id',
          },
          seller: { status: 'APPROVED', user: { status: 'ACTIVE' } },
          condition: 'USED',
          variants: {
            some: {
              isActive: true,
              stockQuantity: { gt: 0 },
              price: { gte: 10, lte: 30 },
            },
          },
          OR: [
            { titleEn: { contains: 'linen shirt', mode: 'insensitive' } },
            { titleAm: { contains: 'linen shirt', mode: 'insensitive' } },
            {
              descriptionEn: {
                contains: 'linen shirt',
                mode: 'insensitive',
              },
            },
            {
              descriptionAm: {
                contains: 'linen shirt',
                mode: 'insensitive',
              },
            },
          ],
        }),
      }),
    );
    expect(analyticsUpsert).toHaveBeenCalledWith({
      where: { term: 'linen shirt' },
      create: {
        term: 'linen shirt',
        searchCount: 1,
        totalResultCount: 3,
      },
      update: {
        searchCount: { increment: 1 },
        totalResultCount: { increment: 3 },
      },
    });
  });

  it('sorts products by their lowest eligible variant price and paginates in SQL', async () => {
    const products = [{ id: 'first' }, { id: 'second' }];
    const findMany = vi.fn().mockResolvedValue([products[1], products[0]]);
    const queryRaw = vi
      .fn()
      .mockResolvedValue([{ id: 'first' }, { id: 'second' }]);
    const count = vi.fn().mockResolvedValue(2);
    const { service, transaction } = createCatalogService(
      findMany,
      count,
      vi.fn(),
      queryRaw,
    );

    await expect(
      service.listPublicProducts({
        page: 2,
        limit: 1,
        minPrice: 15,
        sort: 'price_asc',
      }),
    ).resolves.toMatchObject({
      data: [products[0], products[1]],
      page: 2,
      limit: 1,
      total: 2,
    });

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'APPROVED',
          variants: {
            some: {
              isActive: true,
              stockQuantity: { gt: 0 },
              price: { gte: 15 },
            },
          },
        }),
      }),
    );
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('rejects inverted price ranges before querying and does not log empty searches', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const { service, transaction, analyticsUpsert } =
      createCatalogService(findMany);

    await expect(
      service.listPublicProducts({
        page: 1,
        limit: 20,
        minPrice: 20,
        maxPrice: 10,
        sort: 'newest',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(transaction).not.toHaveBeenCalled();

    await service.listPublicProducts({
      page: 1,
      limit: 20,
      q: '   ',
      sort: 'newest',
    });
    expect(analyticsUpsert).not.toHaveBeenCalled();
  });
});
