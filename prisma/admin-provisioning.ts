import type { PrismaClient } from '../generated/prisma/client.js';
import { hashPassword } from '../src/auth/password-hash.js';
import { createUserWithRole } from '../src/auth/user-provisioning.js';
import { AdminProvisioningError } from './admin-errors.js';
import { AdminProvisioningInput, validateAdminInput } from './admin-input.js';

const DEVELOPMENT_DATABASE_NAME = 'hulegeb_dev';
const DEVELOPMENT_DATABASE_PORT = 5433;
const POSTGRES_CONTAINER_PORT = 5432;
const PRODUCTION_DATABASE_NAME_PATTERN =
  /(^|[_-])(dev|development|test|testing|staging|qa)([_-]|$)/i;
const DATABASE_TARGET_OVERRIDES = new Set([
  'host',
  'hostaddr',
  'port',
  'dbname',
  'database',
]);

function hasDatabaseTargetOverride(url: URL): boolean {
  return [...url.searchParams.keys()].some((key) =>
    DATABASE_TARGET_OVERRIDES.has(key.toLowerCase()),
  );
}

export class AdminAccountCollisionError extends AdminProvisioningError {
  constructor() {
    super(
      'An account with this email or phone already exists; no changes were made.',
    );
    this.name = 'AdminAccountCollisionError';
  }
}

export function assertDevelopmentDatabaseTarget(
  environment: NodeJS.ProcessEnv,
): URL {
  if (environment.NODE_ENV !== 'development') {
    throw new AdminProvisioningError(
      'Admin provisioning is allowed only when NODE_ENV=development.',
    );
  }

  const value = environment.DATABASE_URL;
  if (!value) {
    throw new AdminProvisioningError(
      'DATABASE_URL is required for development admin provisioning.',
    );
  }

  let url: URL;
  let databaseName: string;
  try {
    url = new URL(value);
    databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    throw new AdminProvisioningError(
      'DATABASE_URL must be a valid local PostgreSQL URL.',
    );
  }

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== String(DEVELOPMENT_DATABASE_PORT) ||
    databaseName !== DEVELOPMENT_DATABASE_NAME ||
    hasDatabaseTargetOverride(url)
  ) {
    throw new AdminProvisioningError(
      'Refusing admin provisioning: DATABASE_URL must target 127.0.0.1:5433/hulegeb_dev.',
    );
  }

  return url;
}

export function assertDevelopmentDatabaseIdentity(
  identity: { databaseName: string; serverPort: number | null }[],
): void {
  if (
    identity.length !== 1 ||
    identity[0].databaseName !== DEVELOPMENT_DATABASE_NAME ||
    identity[0].serverPort !== POSTGRES_CONTAINER_PORT
  ) {
    throw new AdminProvisioningError(
      'Refusing admin provisioning: connected PostgreSQL identity does not match the local development database.',
    );
  }
}

export function assertProductionDatabaseTarget(
  environment: NodeJS.ProcessEnv,
): URL {
  if (environment.NODE_ENV !== 'production') {
    throw new AdminProvisioningError(
      'Production admin provisioning requires NODE_ENV=production.',
    );
  }

  const value = environment.DATABASE_URL;
  if (!value) {
    throw new AdminProvisioningError(
      'DATABASE_URL is required for production admin provisioning.',
    );
  }

  let url: URL;
  let databaseName: string;
  try {
    url = new URL(value);
    databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    throw new AdminProvisioningError(
      'DATABASE_URL must be a valid production PostgreSQL URL.',
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const localHost =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'postgres' ||
    hostname === 'hulegeb-postgres' ||
    hostname === 'host.docker.internal' ||
    hostname === 'gateway.docker.internal' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('127.');

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    localHost ||
    hasDatabaseTargetOverride(url) ||
    !databaseName ||
    PRODUCTION_DATABASE_NAME_PATTERN.test(databaseName)
  ) {
    throw new AdminProvisioningError(
      'Refusing production admin provisioning: DATABASE_URL must target a remote production PostgreSQL database, not a local, development, test, staging, or QA database.',
    );
  }

  return url;
}

export function assertProductionDatabaseIdentity(
  identity: { databaseName: string; serverPort: number | null }[],
  target: URL,
): void {
  const expectedDatabaseName = decodeURIComponent(
    target.pathname.replace(/^\/+/, ''),
  );
  const expectedPort = target.port ? Number(target.port) : 5432;

  if (
    identity.length !== 1 ||
    identity[0].databaseName !== expectedDatabaseName ||
    identity[0].serverPort !== expectedPort ||
    PRODUCTION_DATABASE_NAME_PATTERN.test(identity[0].databaseName)
  ) {
    throw new AdminProvisioningError(
      'Refusing production admin provisioning: connected PostgreSQL identity does not match the configured production database.',
    );
  }
}

export async function verifyDevelopmentDatabase(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  assertDevelopmentDatabaseTarget(environment);
  const identity = await prisma.$queryRaw<
    { databaseName: string; serverPort: number | null }[]
  >`SELECT current_database() AS "databaseName", inet_server_port() AS "serverPort"`;

  assertDevelopmentDatabaseIdentity(identity);
}

export async function verifyProductionDatabase(
  prisma: PrismaClient,
  target: URL,
): Promise<void> {
  assertProductionDatabaseTarget(process.env);
  const identity = await prisma.$queryRaw<
    { databaseName: string; serverPort: number | null }[]
  >`SELECT current_database() AS "databaseName", inet_server_port() AS "serverPort"`;

  assertProductionDatabaseIdentity(identity, target);
}

export async function provisionAdmin(
  prisma: PrismaClient,
  rawInput: AdminProvisioningInput,
  logger: Pick<Console, 'log'> = console,
): Promise<void> {
  const input = validateAdminInput(rawInput);
  const passwordHash = await hashPassword(input.password);

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: { OR: [{ email: input.email }, { phone: input.phone }] },
        select: { id: true },
      });
      if (existing) {
        throw new AdminAccountCollisionError();
      }

      await createUserWithRole(tx, 'ADMIN', {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        passwordHash,
        status: 'PENDING_VERIFICATION',
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
      });
    });
  } catch (error) {
    if (error instanceof AdminAccountCollisionError) {
      throw error;
    }
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      throw new AdminAccountCollisionError();
    }
    throw error;
  }

  logger.log(
    'Administrator provisioned; account remains pending verification.',
  );
}

export async function provisionDevelopmentAdmin(
  prisma: PrismaClient,
  rawInput: AdminProvisioningInput,
  logger: Pick<Console, 'log'> = console,
): Promise<void> {
  await provisionAdmin(prisma, rawInput, logger);
}
