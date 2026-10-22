import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCategoryDto, UpdateCategoryDto } from './catalog.dto.js';

describe('category DTO validation', () => {
  it('accepts bilingual names, slug, optional parent and sort order', () => {
    const input = plainToInstance(CreateCategoryDto, {
      slug: 'new-category',
      nameEn: 'New Category',
      nameAm: 'አዲስ ምድብ',
      parentId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      sortOrder: 2,
    });

    expect(validateSync(input)).toEqual([]);
  });

  it('rejects invalid slugs, blank bilingual names, parent IDs, and sort order', () => {
    const input = plainToInstance(CreateCategoryDto, {
      slug: 'Invalid Slug',
      nameEn: '  ',
      nameAm: '',
      parentId: 'not-a-uuid',
      sortOrder: -1,
    });

    expect(validateSync(input).map(({ property }) => property)).toEqual(
      expect.arrayContaining([
        'slug',
        'nameEn',
        'nameAm',
        'parentId',
        'sortOrder',
      ]),
    );
  });

  it('allows clearing nullable descriptions and the parent relationship', () => {
    const input = plainToInstance(UpdateCategoryDto, {
      descriptionEn: null,
      descriptionAm: null,
      parentId: null,
    });

    expect(validateSync(input)).toEqual([]);
  });

  it('rejects null for non-nullable category fields', () => {
    const input = plainToInstance(UpdateCategoryDto, {
      slug: null,
      nameAm: null,
      sortOrder: null,
    });

    expect(validateSync(input).map(({ property }) => property)).toEqual(
      expect.arrayContaining(['slug', 'nameAm', 'sortOrder']),
    );
  });
});
