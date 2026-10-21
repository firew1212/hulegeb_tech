export const RoleCode = {
  BUYER: 'BUYER',
  SELLER: 'SELLER',
  ADMIN: 'ADMIN',
  DELIVERY_STAFF: 'DELIVERY_STAFF',
} as const;

export const SellerStatus = {
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
} as const;

export const ROLES_KEY = 'roles';
export const PUBLIC_KEY = 'public';
export const REQUIRE_SELLER_APPROVAL_KEY = 'requireSellerApproval';

export type AppRole = (typeof RoleCode)[keyof typeof RoleCode];

export type UserStatus =
  | 'PENDING_VERIFICATION'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'DISABLED';

export type SellerApprovalStatus =
  (typeof SellerStatus)[keyof typeof SellerStatus];

export interface RequestUser {
  id: string;
  roles: AppRole[];
  status: UserStatus;
  sellerStatus?: SellerApprovalStatus;
  sessionId?: string;
}