import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestUser } from '../authorization/authorization.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SellerApplicationDto } from './seller-application.dto.js';

@Injectable()
export class SellerApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  listPending() {
    return this.prisma.sellerProfile.findMany({
      where: { status: 'PENDING_APPROVAL' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        userId: true,
        sellerType: true,
        displayName: true,
        legalName: true,
        status: true,
        createdAt: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    });
  }

  approve(applicationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const application = await tx.sellerProfile.findUnique({
        where: { id: applicationId },
        select: { id: true, userId: true, status: true },
      });
      if (!application) {
        throw new NotFoundException('Seller application not found.');
      }
      if (application.status !== 'PENDING_APPROVAL') {
        throw new ConflictException(
          'Only pending seller applications can be approved.',
        );
      }

      const updated = await tx.sellerProfile.updateMany({
        where: { id: application.id, status: 'PENDING_APPROVAL' },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Seller application status has changed.',
        );
      }

      const sellerRole = await tx.role.upsert({
        where: { code: 'SELLER' },
        update: {},
        create: { code: 'SELLER' },
        select: { id: true },
      });
      await tx.userRole.upsert({
        where: {
          userId_roleId: {
            userId: application.userId,
            roleId: sellerRole.id,
          },
        },
        update: {},
        create: {
          userId: application.userId,
          roleId: sellerRole.id,
        },
      });

      return tx.sellerProfile.findUniqueOrThrow({
        where: { id: application.id },
        select: {
          id: true,
          userId: true,
          sellerType: true,
          displayName: true,
          legalName: true,
          status: true,
          approvedAt: true,
        },
      });
    });
  }

  reject(applicationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const application = await tx.sellerProfile.findUnique({
        where: { id: applicationId },
        select: { id: true, status: true },
      });
      if (!application) {
        throw new NotFoundException('Seller application not found.');
      }
      if (application.status !== 'PENDING_APPROVAL') {
        throw new ConflictException(
          'Only pending seller applications can be rejected.',
        );
      }

      const updated = await tx.sellerProfile.updateMany({
        where: { id: application.id, status: 'PENDING_APPROVAL' },
        data: { status: 'REJECTED' },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Seller application status has changed.',
        );
      }

      return tx.sellerProfile.findUniqueOrThrow({
        where: { id: application.id },
        select: {
          id: true,
          userId: true,
          sellerType: true,
          displayName: true,
          legalName: true,
          status: true,
        },
      });
    });
  }

  async apply(user: RequestUser, input: SellerApplicationDto) {
    try {
      return await this.prisma.sellerProfile.create({
        data: {
          userId: user.id,
          sellerType: input.sellerType,
          displayName: input.displayName.trim(),
          legalName: input.legalName?.trim() || null,
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
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A seller application already exists for this account.',
        );
      }
      throw error;
    }
  }
}
