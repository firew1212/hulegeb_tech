import type { Prisma } from '../../generated/prisma/client.js';

type ProvisionableRole = 'BUYER' | 'ADMIN';

export async function createUserWithRole(
  tx: Prisma.TransactionClient,
  roleCode: ProvisionableRole,
  userData: Omit<Prisma.UserCreateInput, 'userRoles'>,
): Promise<{ id: string }> {
  const role = await tx.role.upsert({
    where: { code: roleCode },
    update: {},
    create: { code: roleCode },
    select: { id: true },
  });

  return tx.user.create({
    data: {
      ...userData,
      userRoles: { create: { roleId: role.id } },
    },
    select: { id: true },
  });
}
