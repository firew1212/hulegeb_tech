import { Injectable } from '@nestjs/common';
import {
  AppRole,
  RequestUser,
  SellerStatus,
  UserStatus,
} from './authorization.constants.js';

@Injectable()
export class AuthorizationService {
  hasRole(user: RequestUser | undefined, role: AppRole): boolean {
    return user?.roles.includes(role) ?? false;
  }

  hasAnyRole(user: RequestUser | undefined, roles: AppRole[]): boolean {
    if (roles.length === 0) {
      return true;
    }

    if (!user) {
      return false;
    }

    return roles.some((role) => user.roles.includes(role));
  }

  isAccountActive(user: RequestUser | undefined): boolean {
    return user?.status === ('ACTIVE' satisfies UserStatus);
  }

  isSellerApproved(user: RequestUser | undefined): boolean {
    return (
      this.isAccountActive(user) &&
      this.hasRole(user, 'SELLER') &&
      user?.sellerStatus === SellerStatus.APPROVED
    );
  }

  canAccess(
    user: RequestUser | undefined,
    requiredRoles: AppRole[] = [],
    requireSellerApproval = false,
  ): boolean {
    if (!this.isAccountActive(user)) {
      return false;
    }

    if (!this.hasAnyRole(user, requiredRoles)) {
      return false;
    }

    if (
      (requireSellerApproval || requiredRoles.includes('SELLER')) &&
      !this.isSellerApproved(user)
    ) {
      return false;
    }

    return true;
  }
}