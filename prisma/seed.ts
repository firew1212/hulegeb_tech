import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { promptForAdminInput } from './admin-input.js';
import { AdminProvisioningError } from './admin-errors.js';
import { seedCategories } from './category-seed.js';
import {
  assertDevelopmentDatabaseTarget,
  provisionDevelopmentAdmin,
  verifyDevelopmentDatabase,
} from './admin-provisioning.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not configured in the .env file.');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== '--admin') || args.length > 1) {
    throw new Error('Usage: pnpm db:seed [--admin].');
  }

  if (args.includes('--admin')) {
    assertDevelopmentDatabaseTarget(process.env);
    await verifyDevelopmentDatabase(prisma);
    const input = await promptForAdminInput();
    await provisionDevelopmentAdmin(prisma, input);
  }

  const roles = ['BUYER', 'SELLER', 'ADMIN', 'DELIVERY_STAFF'] as const;

  for (const code of roles) {
    await prisma.role.upsert({
      where: { code },
      update: {},
      create: { code },
    });

    console.log(`Role ready: ${code}`);
  }

  await seedCategories(prisma);
  console.log('Initial roles and categories seeded successfully.');
}

main()
  .catch((error: unknown) => {
    console.error(
      process.argv.includes('--admin')
        ? error instanceof AdminProvisioningError
          ? error.message
          : 'Admin provisioning failed; details were withheld to protect credentials.'
        : error instanceof Error
          ? error.message
          : 'Seeding failed; details were withheld.',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
