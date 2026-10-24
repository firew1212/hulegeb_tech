import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateOrderDto } from './orders.dto.js';

const variantId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function validate(input: object) {
  return validateSync(plainToInstance(CreateOrderDto, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

function flattenErrors(
  errors: ReturnType<typeof validate>,
): ReturnType<typeof validate> {
  return errors.flatMap((error) => [
    error,
    ...flattenErrors(error.children ?? []),
  ]);
}

describe('CreateOrderDto validation', () => {
  it('accepts up to 20 distinct valid variant lines', () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      variantId: `6ba7b810-9dad-11d1-80b4-${index.toString().padStart(12, '0')}`,
      quantity: 10,
    }));

    expect(validate({ items })).toEqual([]);
  });

  it('rejects an empty order', () => {
    expect(validate({ items: [] }).map(({ property }) => property)).toContain(
      'items',
    );
  });

  it('rejects duplicate variant IDs', () => {
    const errors = validate({
      items: [
        { variantId, quantity: 1 },
        { variantId, quantity: 2 },
      ],
    });

    expect(errors.map(({ property }) => property)).toContain('items');
  });

  it('rejects more than 20 lines', () => {
    const items = Array.from({ length: 21 }, (_, index) => ({
      variantId: `6ba7b810-9dad-11d1-80b4-${index.toString().padStart(12, '0')}`,
      quantity: 1,
    }));

    expect(validate({ items }).map(({ property }) => property)).toContain(
      'items',
    );
  });

  it.each([0, -1, 1.5, 11, '2'])('rejects invalid quantity %j', (quantity) => {
    const errors = validate({ items: [{ variantId, quantity }] });
    expect(flattenErrors(errors).map(({ property }) => property)).toContain(
      'quantity',
    );
  });

  it('rejects invalid variant IDs and client-supplied buyer or price fields', () => {
    const errors = validate({
      buyerId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      items: [{ variantId: 'not-a-uuid', quantity: 1, price: 1 }],
    });

    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining(['buyerId', 'items']),
    );
    expect(flattenErrors(errors).map(({ property }) => property)).toEqual(
      expect.arrayContaining(['variantId', 'price']),
    );
  });
});
