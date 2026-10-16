
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not configured in the .env file.');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const roles = [
    'BUYER',
    'SELLER',
    'ADMIN',
    'DELIVERY_STAFF',
  ] as const;

  for (const code of roles) {
    await prisma.role.upsert({
      where: { code },
      update: {},
      create: { code },
    });

    console.log(`Role ready: ${code}`);
  }

  console.log('Initial roles seeded successfully.');
}

main()
  .catch((error: unknown) => {
    console.error('Failed to seed initial roles:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
