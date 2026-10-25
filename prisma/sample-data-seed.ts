import type { PrismaClient } from '../generated/prisma/client.js';
import { hashPassword } from '../src/auth/password-hash.js';
import { seedCategories } from './category-seed.js';
import {
  assertDevelopmentDatabaseTarget,
  verifyDevelopmentDatabase,
} from './admin-provisioning.js';

type SampleSeedClient = Pick<
  PrismaClient,
  | '$queryRaw'
  | 'role'
  | 'user'
  | 'userRole'
  | 'sellerProfile'
  | 'category'
  | 'product'
  | 'productVariant'
>;

const sampleAccounts = [
  {
    key: 'buyer-one',
    role: 'BUYER',
    firstName: 'Sample',
    lastName: 'Buyer One',
    email: 'sample.buyer.one@example.test',
  },
  {
    key: 'buyer-two',
    role: 'BUYER',
    firstName: 'Sample',
    lastName: 'Buyer Two',
    email: 'sample.buyer.two@example.test',
  },
  {
    key: 'seller-individual',
    role: 'SELLER',
    firstName: 'Sample',
    lastName: 'Individual Seller',
    email: 'sample.seller.individual@example.test',
  },
  {
    key: 'seller-business',
    role: 'SELLER',
    firstName: 'Sample',
    lastName: 'Business Seller',
    email: 'sample.seller.business@example.test',
  },
] as const;

const sampleProducts = [
  {
    slug: 'sample-amharic-smartphone',
    sellerEmail: 'sample.seller.individual@example.test',
    categorySlug: 'mobile-phones-accessories',
    titleEn: 'Sample Android Smartphone',
    titleAm: 'ናሙና አንድሮይድ ስማርት ስልክ',
    descriptionEn: 'Development sample product; pending moderation.',
    descriptionAm: 'የልማት ናሙና ምርት፤ ማረጋገጫ ይጠብቃል።',
    variants: [
      {
        sku: 'HULEGEB-SAMPLE-PHONE-BLACK',
        name: 'Black / 128 GB',
        attributes: { color: 'Black', storage: '128 GB' },
        price: '24999.00',
        stockQuantity: 8,
      },
    ],
  },
  {
    slug: 'sample-cotton-shirt',
    sellerEmail: 'sample.seller.individual@example.test',
    categorySlug: 'mens-clothing',
    titleEn: 'Sample Cotton Shirt',
    titleAm: 'ናሙና የጥጥ ሸሚዝ',
    descriptionEn: 'Development sample clothing product.',
    descriptionAm: 'የልማት ናሙና የልብስ ምርት።',
    variants: [
      {
        sku: 'HULEGEB-SAMPLE-SHIRT-M',
        name: 'Medium',
        attributes: { size: 'M', color: 'White' },
        price: '1250.00',
        stockQuantity: 20,
      },
      {
        sku: 'HULEGEB-SAMPLE-SHIRT-L',
        name: 'Large',
        attributes: { size: 'L', color: 'White' },
        price: '1250.00',
        stockQuantity: 15,
      },
    ],
  },
  {
    slug: 'sample-kitchen-kettle',
    sellerEmail: 'sample.seller.business@example.test',
    categorySlug: 'home-kitchen',
    titleEn: 'Sample Electric Kettle',
    titleAm: 'ናሙና ኤሌክትሪክ የውሃ ማፍያ',
    descriptionEn: 'Development sample household product.',
    descriptionAm: 'የልማት ናሙና የቤት ዕቃ ምርት።',
    variants: [
      {
        sku: 'HULEGEB-SAMPLE-KETTLE-1-7L',
        name: '1.7 L',
        attributes: { capacity: '1.7 L' },
        price: '1850.00',
        stockQuantity: 12,
      },
    ],
  },
] as const;

export async function seedSampleData(
  prisma: SampleSeedClient,
  environment: NodeJS.ProcessEnv,
  password: string,
): Promise<void> {
  assertDevelopmentDatabaseTarget(environment);
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error(
      'SAMPLE_SEED_PASSWORD must be at least 12 characters and at most 72 UTF-8 bytes.',
    );
  }
  await verifyDevelopmentDatabase(prisma, environment);

  const roles = new Map<string, string>();
  for (const code of ['BUYER', 'SELLER', 'ADMIN', 'DELIVERY_STAFF'] as const) {
    const role = await prisma.role.upsert({
      where: { code },
      update: {},
      create: { code },
      select: { id: true },
    });
    roles.set(code, role.id);
  }

  await seedCategories(prisma, { preserveExisting: true });

  const users = new Map<string, string>();
  for (const account of sampleAccounts) {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {},
      create: {
        email: account.email,
        passwordHash,
        firstName: account.firstName,
        lastName: account.lastName,
        status: 'PENDING_VERIFICATION',
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
      },
      select: { id: true },
    });
    users.set(account.key, user.id);

    const roleId = roles.get(account.role);
    if (!roleId) {
      throw new Error(`Required role was not seeded: ${account.role}.`);
    }
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId } },
      update: {},
      create: { userId: user.id, roleId },
    });
  }

  const sellerProfiles = new Map<string, string>();
  for (const seller of [
    {
      key: 'seller-individual',
      type: 'INDIVIDUAL',
      displayName: 'Sample Individual Shop',
      legalName: null,
    },
    {
      key: 'seller-business',
      type: 'BUSINESS',
      displayName: 'Sample Business Store',
      legalName: 'Sample Business Store PLC',
    },
  ] as const) {
    const userId = users.get(seller.key);
    if (!userId) {
      throw new Error(`Required sample seller was not seeded: ${seller.key}.`);
    }
    const profile = await prisma.sellerProfile.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        sellerType: seller.type,
        displayName: seller.displayName,
        legalName: seller.legalName,
        status: 'APPROVED',
        approvedAt: new Date(),
      },
      select: { id: true },
    });
    sellerProfiles.set(seller.key, profile.id);
  }

  for (const productData of sampleProducts) {
    const sellerKey =
      productData.sellerEmail === 'sample.seller.individual@example.test'
        ? 'seller-individual'
        : 'seller-business';
    const sellerId = sellerProfiles.get(sellerKey);
    if (!sellerId) {
      throw new Error(`Required sample seller was not seeded: ${sellerKey}.`);
    }
    const category = await prisma.category.findUnique({
      where: { slug: productData.categorySlug },
      select: { id: true },
    });
    if (!category) {
      throw new Error(
        `Required sample category was not seeded: ${productData.categorySlug}.`,
      );
    }
    const product = await prisma.product.upsert({
      where: { slug: productData.slug },
      update: {},
      create: {
        sellerId,
        categoryId: category.id,
        slug: productData.slug,
        titleEn: productData.titleEn,
        titleAm: productData.titleAm,
        descriptionEn: productData.descriptionEn,
        descriptionAm: productData.descriptionAm,
        condition: 'NEW',
        status: 'PENDING_APPROVAL',
      },
      select: { id: true },
    });

    for (const variant of productData.variants) {
      await prisma.productVariant.upsert({
        where: { sku: variant.sku },
        update: {},
        create: {
          productId: product.id,
          sku: variant.sku,
          name: variant.name,
          attributes: variant.attributes,
          price: variant.price,
          stockQuantity: variant.stockQuantity,
        },
      });
    }
  }
}
