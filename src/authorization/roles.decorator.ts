import { SetMetadata } from '@nestjs/common';
import {
  AppRole,
  PUBLIC_KEY,
  REQUIRE_SELLER_APPROVAL_KEY,
  ROLES_KEY,
} from './authorization.constants.js';

export const RequireRoles = (...roles: AppRole[]) => {
  if (roles.length === 0) {
    throw new Error(
      '@RequireRoles() must specify at least one role.',
    );
  }

  return SetMetadata(ROLES_KEY, [...new Set(roles)]);
};

export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const RequireSellerApproval = () =>
  SetMetadata(REQUIRE_SELLER_APPROVAL_KEY, true);