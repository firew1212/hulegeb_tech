export interface CategorySeed {
  slug: string;
  nameEn: string;
  nameAm: string;
  children: Omit<CategorySeed, 'children'>[];
}

export const CATEGORY_SEED_DATA: CategorySeed[] = [
  {
    slug: 'electronics-accessories',
    nameEn: 'Electronics and Accessories',
    nameAm: 'ኤሌክትሮኒክስና ተዛማጅ መለዋወጫዎች',
    children: [
      {
        slug: 'mobile-phones-accessories',
        nameEn: 'Mobile Phones and Accessories',
        nameAm: 'ሞባይል ስልኮችና መለዋወጫዎቻቸው',
      },
      {
        slug: 'computers-laptops',
        nameEn: 'Computers and Laptops',
        nameAm: 'ኮምፒውተሮችና ላፕቶፖች',
      },
      {
        slug: 'audio-headphones',
        nameEn: 'Audio and Headphones',
        nameAm: 'የድምፅ መሣሪያዎችና የጆሮ ማዳመጫዎች',
      },
      {
        slug: 'chargers-cables-power-accessories',
        nameEn: 'Chargers, Cables and Power Accessories',
        nameAm: 'ቻርጀሮች፣ ኬብሎችና የኃይል መለዋወጫዎች',
      },
      {
        slug: 'cameras-electronic-devices',
        nameEn: 'Cameras and Electronic Devices',
        nameAm: 'ካሜራዎችና የተለያዩ ኤሌክትሮኒክስ መሣሪያዎች',
      },
    ],
  },
  {
    slug: 'clothing-shoes-fashion',
    nameEn: 'Clothing, Shoes, and Fashion',
    nameAm: 'ልብስ፣ ጫማና የፋሽን ዕቃዎች',
    children: [
      {
        slug: 'mens-clothing',
        nameEn: "Men's Clothing",
        nameAm: 'የወንዶች ልብስ',
      },
      {
        slug: 'womens-clothing',
        nameEn: "Women's Clothing",
        nameAm: 'የሴቶች ልብስ',
      },
      {
        slug: 'childrens-clothing',
        nameEn: "Children's Clothing",
        nameAm: 'የሕፃናት ልብስ',
      },
      {
        slug: 'shoes-sneakers',
        nameEn: 'Shoes and Sneakers',
        nameAm: 'ጫማዎችና ስፖርታዊ ጫማዎች',
      },
      {
        slug: 'bags-accessories',
        nameEn: 'Bags and Accessories',
        nameAm: 'ቦርሳዎችና ተዛማጅ የፋሽን ዕቃዎች',
      },
    ],
  },
  {
    slug: 'mixed-category',
    nameEn: 'Mixed Category',
    nameAm: 'የተለያዩ ዕቃዎች',
    children: [
      {
        slug: 'automobiles-related-products',
        nameEn: 'Automobiles and Related Products',
        nameAm: 'መኪናዎችና ተዛማጅ ምርቶች',
      },
      {
        slug: 'home-kitchen',
        nameEn: 'Home and Kitchen',
        nameAm: 'የቤትና የወጥ ቤት ዕቃዎች',
      },
      {
        slug: 'gaming',
        nameEn: 'Gaming',
        nameAm: 'የጨዋታ መሣሪያዎችና ዕቃዎች',
      },
      {
        slug: 'household-items',
        nameEn: 'Household Items',
        nameAm: 'የቤት ውስጥ ዕቃዎች',
      },
      {
        slug: 'other-products',
        nameEn: 'Other Products',
        nameAm: 'ሌሎች ምርቶች',
      },
    ],
  },
];

interface CategoryUpsertClient {
  category: {
    upsert(args: {
      where: { slug: string };
      update:
        | {
            parentId: string | null;
            nameEn: string;
            nameAm: string;
            sortOrder: number;
          }
        | Record<string, never>;
      create: {
        slug: string;
        parentId: string | null;
        nameEn: string;
        nameAm: string;
        sortOrder: number;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
}

export async function seedCategories(
  prisma: CategoryUpsertClient,
  options: { preserveExisting?: boolean } = {},
) {
  const updateExisting = options.preserveExisting !== true;
  for (const [parentIndex, parent] of CATEGORY_SEED_DATA.entries()) {
    const seededParent = await prisma.category.upsert({
      where: { slug: parent.slug },
      update: updateExisting
        ? {
            parentId: null,
            nameEn: parent.nameEn,
            nameAm: parent.nameAm,
            sortOrder: parentIndex,
          }
        : {},
      create: {
        slug: parent.slug,
        parentId: null,
        nameEn: parent.nameEn,
        nameAm: parent.nameAm,
        sortOrder: parentIndex,
      },
      select: { id: true },
    });

    for (const [childIndex, child] of parent.children.entries()) {
      await prisma.category.upsert({
        where: { slug: child.slug },
        update: updateExisting
          ? {
              parentId: seededParent.id,
              nameEn: child.nameEn,
              nameAm: child.nameAm,
              sortOrder: childIndex,
            }
          : {},
        create: {
          slug: child.slug,
          parentId: seededParent.id,
          nameEn: child.nameEn,
          nameAm: child.nameAm,
          sortOrder: childIndex,
        },
        select: { id: true },
      });
    }
  }
}
