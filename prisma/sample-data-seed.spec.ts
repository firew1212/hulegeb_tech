import type { PrismaClient } from '../generated/prisma/client.js';
import { seedSampleData } from './sample-data-seed.js';

vi.mock('../src/auth/password-hash.js', () => ({
  hashPassword: vi.fn(async () => 'sample-hash'),
}));

describe('development sample data seed', () => {
  const safeEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://user:password@127.0.0.1:5433/hulegeb_dev',
  };

  function createPrismaMock() {
    const ids = new Map<string, string>();
    const writeCalls = new Map<string, { update?: object }[]>();
    const upsert = (name: string) =>
      vi.fn(async ({ where, update }: { where: object; update?: object }) => {
        const calls = writeCalls.get(name) ?? [];
        calls.push({ update });
        writeCalls.set(name, calls);
        const key = `${name}:${JSON.stringify(where)}`;
        if (!ids.has(key)) {
          ids.set(key, `id-${ids.size}`);
        }
        return { id: ids.get(key)! };
      });
    const categoryUpsert = vi.fn(
      async ({ where }: { where: { slug: string } }) => ({
        id: `category-${where.slug}`,
      }),
    );

    return {
      prisma: {
        $queryRaw: vi.fn(async () => [
          { databaseName: 'hulegeb_dev', serverPort: 5432 },
        ]),
        role: { upsert: upsert('role') },
        user: { upsert: upsert('user') },
        userRole: { upsert: vi.fn(async () => ({})) },
        sellerProfile: { upsert: upsert('sellerProfile') },
        category: {
          upsert: categoryUpsert,
          findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => ({
            id: `category-${where.slug}`,
          })),
        },
        product: { upsert: upsert('product') },
        productVariant: { upsert: upsert('productVariant') },
      } as unknown as PrismaClient,
      ids,
      writeCalls,
    };
  }

  it('can be rerun without duplicate identities or overwriting existing records', async () => {
    const { prisma, ids, writeCalls } = createPrismaMock();
    await seedSampleData(prisma, safeEnvironment, 'local-sample-password-2026');
    const seededIdentities = new Set(ids.keys());

    await seedSampleData(prisma, safeEnvironment, 'local-sample-password-2026');

    expect(ids.size).toBe(seededIdentities.size);
    expect(prisma.user.upsert).toHaveBeenCalledTimes(8);
    expect(prisma.product.upsert).toHaveBeenCalledTimes(6);
    expect(prisma.productVariant.upsert).toHaveBeenCalledTimes(8);
    for (const name of ['user', 'sellerProfile', 'product', 'productVariant']) {
      expect(
        writeCalls
          .get(name)
          ?.every(
            ({ update }) =>
              update !== undefined && Object.keys(update).length === 0,
          ),
      ).toBe(true);
    }
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'sample.buyer.one@example.test' },
        create: expect.objectContaining({
          status: 'PENDING_VERIFICATION',
          emailVerifiedAt: null,
          phoneVerifiedAt: null,
        }),
      }),
    );
    expect(prisma.product.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'sample-amharic-smartphone' },
        create: expect.objectContaining({
          titleEn: 'Sample Android Smartphone',
          titleAm: 'ናሙና አንድሮይድ ስማርት ስልክ',
          status: 'PENDING_APPROVAL',
        }),
      }),
    );
    expect(prisma.productVariant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sku: 'HULEGEB-SAMPLE-PHONE-BLACK' },
        create: expect.objectContaining({
          price: '24999.00',
          stockQuantity: 8,
        }),
      }),
    );
    expect(prisma.sellerProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'APPROVED' }),
      }),
    );
  });

  it('refuses an unsafe database target before querying or writing', async () => {
    const { prisma } = createPrismaMock();

    await expect(
      seedSampleData(
        prisma,
        { ...safeEnvironment, DATABASE_URL: 'postgresql://db.example/prod' },
        'local-sample-password-2026',
      ),
    ).rejects.toThrow();

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.role.upsert).not.toHaveBeenCalled();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('refuses a connected database with the wrong identity before writing', async () => {
    const { prisma } = createPrismaMock();
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { databaseName: 'hulegeb_auth_test', serverPort: 5432 },
    ] as never);

    await expect(
      seedSampleData(prisma, safeEnvironment, 'local-sample-password-2026'),
    ).rejects.toThrow();

    expect(prisma.role.upsert).not.toHaveBeenCalled();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });
});
