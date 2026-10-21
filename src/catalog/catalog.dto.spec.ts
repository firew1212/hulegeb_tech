import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateProductDto,
  CreateProductImageDto,
  CreateProductVariantDto,
  UpdateProductDto,
  UpdateProductImageDto,
  UpdateProductVariantDto,
} from './catalog.dto.js';

describe('catalog DTO validation', () => {
  it('accepts valid bilingual product input and a URL-safe slug', () => {
    const input = plainToInstance(CreateProductDto, {
      categoryId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      slug: 'sample-product-1',
      titleEn: 'Sample Product',
      titleAm: 'የሙከራ ምርት',
      condition: 'NEW',
    });

    expect(validateSync(input)).toEqual([]);
  });

  it('rejects invalid category IDs, slugs, and blank product titles', () => {
    const input = plainToInstance(CreateProductDto, {
      categoryId: 'not-a-uuid',
      slug: 'Sample Product',
      titleEn: '  ',
      titleAm: 'ምርት',
    });

    expect(validateSync(input).map(({ property }) => property)).toEqual(
      expect.arrayContaining(['categoryId', 'slug', 'titleEn']),
    );
  });

  it('rejects invalid price precision and negative variant stock', () => {
    const input = plainToInstance(CreateProductVariantDto, {
      sku: 'SKU-1',
      name: 'Default',
      price: 1.239,
      stockQuantity: -1,
    });

    expect(validateSync(input).map(({ property }) => property)).toEqual(
      expect.arrayContaining(['price', 'stockQuantity']),
    );
  });

  it('accepts only HTTPS image URLs', () => {
    const input = plainToInstance(CreateProductImageDto, {
      imageUrl: 'http://images.example.test/product.jpg',
    });

    expect(validateSync(input).map(({ property }) => property)).toContain(
      'imageUrl',
    );
  });

  it('rejects null for optional fields that are non-nullable in the database', () => {
    const product = plainToInstance(UpdateProductDto, { slug: null });
    const variant = plainToInstance(UpdateProductVariantDto, {
      stockQuantity: null,
    });
    const image = plainToInstance(UpdateProductImageDto, {
      imageUrl: null,
    });

    expect(validateSync(product).map(({ property }) => property)).toContain(
      'slug',
    );
    expect(validateSync(variant).map(({ property }) => property)).toContain(
      'stockQuantity',
    );
    expect(validateSync(image).map(({ property }) => property)).toContain(
      'imageUrl',
    );
  });
});
