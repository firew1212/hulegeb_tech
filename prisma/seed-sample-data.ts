import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { seedSampleData } from './sample-data-seed.js';

const connectionString = process.env.DATABASE_URL;
const password = process.env.SAMPLE_SEED_PASSWORD;

if (!connectionString) {
  throw new Error('DATABASE_URL is not configured in the .env file.');
}
if (!password) {
  throw new Error(
    'SAMPLE_SEED_PASSWORD is required; provide a local-only password of at least 12 characters.',
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

seedSampleData(prisma, process.env, password)
  .then(() => {
    console.log(
      'Development sample data seeded. Sample users remain pending verification and products remain pending moderation.',
    );
  })
  .catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Sample data seeding failed; details were withheld.',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
