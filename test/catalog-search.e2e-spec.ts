import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { CatalogController } from '../src/catalog/catalog.controller.js';
import { CatalogService } from '../src/catalog/catalog.service.js';

describe('Public catalog search HTTP endpoint', () => {
  let app: INestApplication<App>;
  const listPublicProducts = vi.fn();

  beforeAll(async () => {
    @Module({
      controllers: [CatalogController],
      providers: [
        { provide: CatalogService, useValue: { listPublicProducts } },
      ],
    })
    class CatalogSearchE2eModule {}

    const testingModule = await Test.createTestingModule({
      imports: [CatalogSearchE2eModule],
    }).compile();

    app = testingModule.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    listPublicProducts.mockImplementation(async ({ page, limit }) => ({
      data: [],
      page,
      limit,
      total: 0,
      totalPages: 0,
    }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('routes normalized search, filters, sorting, and pagination to catalog search', async () => {
    await request(app.getHttpServer())
      .get(
        '/catalog/products?q=%20linen%20%20shirt%20&categoryId=6ba7b810-9dad-11d1-80b4-00c04fd430c8&minPrice=10&maxPrice=25&condition=USED&sort=price_asc&page=2&limit=5',
      )
      .expect(200)
      .expect({
        data: [],
        page: 2,
        limit: 5,
        total: 0,
        totalPages: 0,
      });

    expect(listPublicProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'linen shirt',
        categoryId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        minPrice: 10,
        maxPrice: 25,
        condition: 'USED',
        sort: 'price_asc',
        page: 2,
        limit: 5,
      }),
    );
  });

  it.each([
    '/catalog/products?sort=rating',
    '/catalog/products?categoryId=not-a-uuid',
    '/catalog/products?limit=101',
    '/catalog/products?unknownFilter=true',
  ])('rejects invalid query parameters: %s', async (path) => {
    await request(app.getHttpServer()).get(path).expect(400);
  });
});
