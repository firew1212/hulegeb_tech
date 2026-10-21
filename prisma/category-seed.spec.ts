import { CATEGORY_SEED_DATA, seedCategories } from './category-seed.js';

describe('category seed data', () => {
  it('contains only the three specified parents and their 15 children', () => {
    expect(CATEGORY_SEED_DATA.map(({ nameEn }) => nameEn)).toEqual([
      'Electronics and Accessories',
      'Clothing, Shoes, and Fashion',
      'Mixed Category',
    ]);
    expect(
      CATEGORY_SEED_DATA.reduce(
        (count, category) => count + category.children.length,
        0,
      ),
    ).toBe(15);
    expect(CATEGORY_SEED_DATA.flatMap(({ children }) => children)).toHaveLength(
      15,
    );
  });

  it('upserts children under their specified parent and preserves bilingual names', async () => {
    const upsert = vi.fn(async ({ where }: { where: { slug: string } }) => ({
      id: `id-${where.slug}`,
    }));

    await seedCategories({ category: { upsert } });

    expect(upsert).toHaveBeenCalledTimes(18);
    expect(upsert).toHaveBeenCalledWith({
      where: { slug: 'electronics-accessories' },
      update: {
        parentId: null,
        nameEn: 'Electronics and Accessories',
        nameAm: 'ኤሌክትሮኒክስና ተዛማጅ መለዋወጫዎች',
        sortOrder: 0,
      },
      create: {
        slug: 'electronics-accessories',
        parentId: null,
        nameEn: 'Electronics and Accessories',
        nameAm: 'ኤሌክትሮኒክስና ተዛማጅ መለዋወጫዎች',
        sortOrder: 0,
      },
      select: { id: true },
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'mobile-phones-accessories' },
        create: expect.objectContaining({
          parentId: 'id-electronics-accessories',
          nameAm: 'ሞባይል ስልኮችና መለዋወጫዎቻቸው',
        }),
      }),
    );
  });
});
