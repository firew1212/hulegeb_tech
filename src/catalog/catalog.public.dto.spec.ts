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
});
