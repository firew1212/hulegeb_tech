import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleCode } from './authorization.constants.js';
import { AuthorizationService } from './authorization.service.js';
import { RequireRoles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

const buyerUser = {
  id: 'buyer-1',
  roles: [RoleCode.BUYER],
  status: 'ACTIVE',
};

const sellerUserPendingApproval = {
  id: 'seller-1',
  roles: [RoleCode.SELLER],
  status: 'ACTIVE',
  sellerStatus: 'PENDING_APPROVAL',
};

const sellerUserRejected = {
  id: 'seller-3',
  roles: [RoleCode.SELLER],
  status: 'ACTIVE',
  sellerStatus: 'REJECTED',
};

const sellerUserApproved = {
  id: 'seller-2',
  roles: [RoleCode.SELLER],
  status: 'ACTIVE',
  sellerStatus: 'APPROVED',
};

const adminUser = {
  id: 'admin-1',
  roles: [RoleCode.ADMIN],
  status: 'ACTIVE',
};

describe('AuthorizationService', () => {
  let service: AuthorizationService;

  beforeEach(() => {
    service = new AuthorizationService();
  });

  it('allows a buyer to access buyer-only routes', () => {
    expect(service.canAccess(buyerUser, [RoleCode.BUYER])).toBe(true);
  });

  it('denies access for a seller that has not been approved', () => {
    expect(
      service.canAccess(sellerUserPendingApproval, [RoleCode.SELLER], true),
    ).toBe(false);
  });

  it('allows an approved seller to access seller-only routes', () => {
    expect(service.canAccess(sellerUserApproved, [RoleCode.SELLER], true)).toBe(
      true,
    );
  });

  it.each([sellerUserPendingApproval, sellerUserRejected])(
    'denies seller-only access for seller status $sellerStatus',
    (user) => {
      expect(service.canAccess(user, [RoleCode.SELLER])).toBe(false);
    },
  );

  it('allows an admin to access admin routes', () => {
    expect(service.canAccess(adminUser, [RoleCode.ADMIN])).toBe(true);
  });
});

describe('RolesGuard', () => {
  let service: AuthorizationService;
  let guard: RolesGuard;

  beforeEach(() => {
    service = new AuthorizationService();
    guard = new RolesGuard(new Reflector(), service);
  });

  it('rejects seller access when approval is missing', () => {
    const handler = () => undefined;
    RequireRoles(RoleCode.SELLER)(handler);

    const context = {
      getHandler: () => handler,
      getClass: () => class TestController {},
      switchToHttp: () => ({
        getRequest: () => ({ user: sellerUserPendingApproval }),
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows admin access for an authenticated admin', () => {
    const handler = () => undefined;
    RequireRoles(RoleCode.ADMIN)(handler);

    const context = {
      getHandler: () => handler,
      getClass: () => class TestController {},
      switchToHttp: () => ({
        getRequest: () => ({ user: adminUser }),
      }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });
});
