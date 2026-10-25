import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import {
  confirmProductionDatabaseTarget,
  promptForAdminInput,
} from './admin-input.js';
import { AdminProvisioningError } from './admin-errors.js';
import {
  assertProductionDatabaseTarget,
  provisionAdmin,
  verifyProductionDatabase,
} from './admin-provisioning.js';

async function main(): Promise<void> {
  if (process.argv.length !== 2) {
    throw new AdminProvisioningError(
      'Usage: pnpm db:provision:admin (interactive; no arguments accepted).',
    );
  }

  const target = assertProductionDatabaseTarget(process.env);
  await confirmProductionDatabaseTarget(target);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new AdminProvisioningError(
      'DATABASE_URL is required for production admin provisioning.',
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    await verifyProductionDatabase(prisma, target);
    const input = await promptForAdminInput();
    await provisionAdmin(prisma, input);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof AdminProvisioningError
      ? error.message
      : 'Production admin provisioning failed; details were withheld to protect credentials.',
  );
  process.exitCode = 1;
});
