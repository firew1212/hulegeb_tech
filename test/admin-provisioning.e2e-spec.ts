import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '../generated/prisma/client.js';
import {
  AdminAccountCollisionError,
  provisionDevelopmentAdmin,
} from '../prisma/admin-provisioning.js';
import type { AdminProvisioningInput } from '../prisma/admin-input.js';

describe('development admin provisioning against the isolated test database', () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('AUTH_TEST_DATABASE_URL is required by the e2e setup.');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      createdUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function input(): AdminProvisioningInput {
    const suffix = randomUUID();
    const phoneSuffix = (randomBytes(4).readUInt32BE(0) % 100_000_000)
      .toString()
      .padStart(8, '0');

    return {
      firstName: 'Ada',
      lastName: 'Example',
      email: `admin-${suffix}@example.test`,
      phone: `+2519${phoneSuffix}`,
      password: randomBytes(24).toString('base64url'),
    };
  }

  async function registerForCleanup(email: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (user) {
      createdUserIds.push(user.id);
    }
  }

  it('creates a pending admin, assigns only ADMIN, and never logs credentials', async () => {
    const credentials = input();
    const messages: string[] = [];

    await provisionDevelopmentAdmin(prisma, credentials, {
      log: (message) => messages.push(message),
    });

    await registerForCleanup(credentials.email);
    const created = await prisma.user.findUniqueOrThrow({
      where: { email: credentials.email },
      include: { userRoles: { include: { role: true } } },
    });

    expect(created.firstName).toBe(credentials.firstName);
    expect(created.lastName).toBe(credentials.lastName);
    expect(created.phone).toBe(credentials.phone);
    expect(created.status).toBe('PENDING_VERIFICATION');
    expect(created.emailVerifiedAt).toBeNull();
    expect(created.phoneVerifiedAt).toBeNull();
    expect(
      await bcrypt.compare(credentials.password, created.passwordHash),
    ).toBe(true);
    expect(created.userRoles.map(({ role }) => role.code)).toEqual(['ADMIN']);
    expect(messages).toHaveLength(1);
    expect(messages.join(' ')).not.toContain(credentials.password);
    expect(messages.join(' ')).not.toContain(credentials.email);
    expect(messages.join(' ')).not.toContain(credentials.phone);
    expect(messages.join(' ')).not.toContain(credentials.firstName);
    expect(messages.join(' ')).not.toContain(credentials.lastName);
  });

  it('refuses a repeat without adding another user or role assignment', async () => {
    const credentials = input();
    await provisionDevelopmentAdmin(prisma, credentials, { log: () => {} });
    await registerForCleanup(credentials.email);

    await expect(
      provisionDevelopmentAdmin(prisma, credentials, { log: () => {} }),
    ).rejects.toBeInstanceOf(AdminAccountCollisionError);

    const created = await prisma.user.findUniqueOrThrow({
      where: { email: credentials.email },
      include: { userRoles: true },
    });
    expect(created.userRoles).toHaveLength(1);
    expect(
      await prisma.user.count({ where: { email: credentials.email } }),
    ).toBe(1);
  });

  it.each(['email', 'phone'] as const)(
    'does not promote an existing account when its %s collides',
    async (collisionField) => {
      const existingInput = input();
      const existingUser = await prisma.user.create({
        data: {
          firstName: existingInput.firstName,
          lastName: existingInput.lastName,
          email: existingInput.email,
          phone: existingInput.phone,
          passwordHash: randomUUID(),
        },
        select: { id: true },
      });
      createdUserIds.push(existingUser.id);

      const requested = input();
      if (collisionField === 'email') {
        requested.email = existingInput.email;
      } else {
        requested.phone = existingInput.phone;
      }

      await expect(
        provisionDevelopmentAdmin(prisma, requested, { log: () => {} }),
      ).rejects.toBeInstanceOf(AdminAccountCollisionError);

      const existing = await prisma.user.findUniqueOrThrow({
        where: { id: existingUser.id },
        include: { userRoles: true },
      });
      expect(existing.userRoles).toHaveLength(0);
    },
  );
});
