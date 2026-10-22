import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ParseUUIDPipe } from '@nestjs/common';
import { PublicProductPaginationDto } from './catalog.dto.js';

describe('public product pagination validation', () => {
  it('uses default pagination values', () => {
    const pagination = plainToInstance(PublicProductPaginationDto, {});

    expect(validateSync(pagination)).toEqual([]);
    expect(pagination).toMatchObject({ page: 1, limit: 20 });
  });

  describe('public product ID validation', () => {
    it('rejects IDs that are not UUIDs', async () => {
      await expect(
        new ParseUUIDPipe().transform('not-a-uuid', {
          type: 'param',
          data: 'productId',
          metatype: String,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  it('converts valid query strings to bounded integer pagination', () => {
    const pagination = plainToInstance(PublicProductPaginationDto, {
      page: '3',
      limit: '50',
    });

    expect(validateSync(pagination)).toEqual([]);
    expect(pagination).toMatchObject({ page: 3, limit: 50 });
  });

  it.each([
    [{ page: '0', limit: '20' }, ['page']],
    [{ page: '1.5', limit: '20' }, ['page']],
    [{ page: 'nope', limit: '20' }, ['page']],
    [{ page: '1', limit: '101' }, ['limit']],
    [{ page: ['1'], limit: '20' }, ['page']],
  ])('rejects invalid pagination query %j', (query, invalidFields) => {
    const pagination = plainToInstance(PublicProductPaginationDto, query);

    expect(validateSync(pagination).map(({ property }) => property)).toEqual(
      expect.arrayContaining(invalidFields),
    );
  });

  it('normalizes search terms and transforms filter values', () => {
    const pagination = plainToInstance(PublicProductPaginationDto, {
      q: '  Linen   shirt ',
      categoryId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      subcategoryId: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
      minPrice: '12.50',
      maxPrice: '25',
      condition: 'USED',
      sort: 'price_asc',
    });

    expect(validateSync(pagination)).toEqual([]);
    expect(pagination).toMatchObject({
      q: 'Linen shirt',
      minPrice: 12.5,
      maxPrice: 25,
      condition: 'USED',
      sort: 'price_asc',
    });
  });

  it.each([
    [{ minPrice: '-1' }, ['minPrice']],
    [{ maxPrice: '10.001' }, ['maxPrice']],
    [{ categoryId: 'not-a-uuid' }, ['categoryId']],
    [{ condition: 'DAMAGED' }, ['condition']],
    [{ sort: 'rating' }, ['sort']],
    [{ q: 'x'.repeat(101) }, ['q']],
  ])('rejects invalid public search query %j', (query, invalidFields) => {
    const pagination = plainToInstance(PublicProductPaginationDto, query);

    expect(validateSync(pagination).map(({ property }) => property)).toEqual(
      expect.arrayContaining(invalidFields),
    );
  });
});
