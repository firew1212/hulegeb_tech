export const AuthChallengeType = {
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  PHONE_VERIFICATION: 'PHONE_VERIFICATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
  ADMIN_LOGIN_MFA: 'ADMIN_LOGIN_MFA',
} as const;

export type AuthChallengeType =
  (typeof AuthChallengeType)[keyof typeof AuthChallengeType];

export const AccountStatus = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DISABLED: 'DISABLED',
} as const;

export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];
