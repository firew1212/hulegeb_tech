import { ConflictException } from '@nestjs/common';
import type { RequestUser } from '../authorization/authorization.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SellerApplicationsService } from './seller-applications.service.js';

const buyer: RequestUser = {
  id: 'authenticated-buyer-id',
  roles: ['BUYER'],
  status: 'ACTIVE',
};

function createService(create: ReturnType<typeof vi.fn>) {
  const prisma = {
    sellerProfile: { create },
  } as unknown as PrismaService;
  return new SellerApplicationsService(prisma);
}

function createReviewService(transactionClient: object) {
  const transaction = vi.fn(
    (callback: (tx: typeof transactionClient) => unknown) =>
      callback(transactionClient),
  );
  const findMany = vi.fn();
  const prisma = {
    $transaction: transaction,
    sellerProfile: {
      findMany,
    },
  } as unknown as PrismaService;
  return {
    service: new SellerApplicationsService(prisma),
    transaction,
    findMany,
  };
}

describe('SellerApplicationsService', () => {
  it.each(['INDIVIDUAL', 'BUSINESS'] as const)(
    'creates a pending %s application for the authenticated user',
    async (sellerType) => {
      const create = vi.fn().mockResolvedValue({
        id: 'application-1',
        sellerType,
        displayName: 'Shop Name',
        legalName: null,
        status: 'PENDING_APPROVAL',
        createdAt: new Date(),
      });
      const service = createService(create);

      await service.apply(buyer, {
        sellerType,
        displayName: ' Shop Name ',
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          userId: buyer.id,
          sellerType,
          displayName: 'Shop Name',
          legalName: null,
          status: 'PENDING_APPROVAL',
        },
        select: {
          id: true,
          sellerType: true,
          displayName: true,
          legalName: true,
          status: true,
          createdAt: true,
        },
      });
    },
  );

  it('returns a conflict for an existing application', async () => {
    const create = vi.fn().mockRejectedValue({ code: 'P2002' });
    const service = createService(create);

    await expect(
      service.apply(buyer, {
        sellerType: 'INDIVIDUAL',
        displayName: 'Shop Name',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not swallow unrelated database errors', async () => {
    const databaseError = new Error('database unavailable');
    const service = createService(vi.fn().mockRejectedValue(databaseError));

    await expect(
      service.apply(buyer, {
        sellerType: 'INDIVIDUAL',
        displayName: 'Shop Name',
      }),
    ).rejects.toBe(databaseError);
  });

  it('lists only pending applications with applicant details', async () => {
    const applications = [{ id: 'application-1', status: 'PENDING_APPROVAL' }];
    const { service, findMany } = createReviewService({});
    findMany.mockResolvedValue(applications);

    await expect(service.listPending()).resolves.toEqual(applications);
    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING_APPROVAL' },
      orderBy: { createdAt: 'asc' },
      select: expect.objectContaining({
        id: true,
        userId: true,
        user: expect.any(Object),
      }),
    });
  });

  it('approves only a pending profile and assigns SELLER to that profile owner', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'application-1', userId: 'applicant-1', status: 'PENDING_APPROVAL' });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue({
      id: 'application-1',
      userId: 'applicant-1',
      status: 'APPROVED',
    });
    const roleUpsert = vi.fn().mockResolvedValue({ id: 'seller-role-id' });
    const userRoleUpsert = vi.fn().mockResolvedValue({});
    const { service, transaction } = createReviewService({
      sellerProfile: { findUnique, updateMany, findUniqueOrThrow },
      role: { upsert: roleUpsert },
      userRole: { upsert: userRoleUpsert },
    });

    await expect(service.approve('application-1')).resolves.toMatchObject({
      id: 'application-1',
      status: 'APPROVED',
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'application-1', status: 'PENDING_APPROVAL' },
      data: { status: 'APPROVED', approvedAt: expect.any(Date) },
    });
    expect(userRoleUpsert).toHaveBeenCalledWith({
      where: {
        userId_roleId: { userId: 'applicant-1', roleId: 'seller-role-id' },
      },
      update: {},
      create: { userId: 'applicant-1', roleId: 'seller-role-id' },
    });
    expect(transaction).toHaveBeenCalledOnce();
  });

  it.each([
    [null, 'not found'],
    [{ id: 'application-1', status: 'REJECTED' }, 'already rejected'],
  ])('refuses to approve an unavailable or non-pending application', async (
    application,
  ) => {
    const findUnique = vi.fn().mockResolvedValue(application);
    const { service } = createReviewService({
      sellerProfile: { findUnique },
      role: { upsert: vi.fn() },
      userRole: { upsert: vi.fn() },
    });

    if (application === null) {
      await expect(service.approve('missing')).rejects.toMatchObject({
        status: 404,
      });
    } else {
      await expect(service.approve('application-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    }
  });

  it('rejects only pending applications without assigning seller access', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'application-2', status: 'PENDING_APPROVAL' });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue({
      id: 'application-2',
      status: 'REJECTED',
    });
    const userRoleUpsert = vi.fn();
    const { service } = createReviewService({
      sellerProfile: { findUnique, updateMany, findUniqueOrThrow },
      userRole: { upsert: userRoleUpsert },
    });

    await expect(service.reject('application-2')).resolves.toMatchObject({
      status: 'REJECTED',
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'application-2', status: 'PENDING_APPROVAL' },
      data: { status: 'REJECTED' },
    });
    expect(userRoleUpsert).not.toHaveBeenCalled();
  });
});
