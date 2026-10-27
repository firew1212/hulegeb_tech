import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import {
  createHmac,
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword } from './password-hash.js';
import { createUserWithRole } from './user-provisioning.js';
import { AccountStatus, AuthChallengeType } from './auth.constants.js';
import {
  ForgotPasswordDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './auth.dto.js';
import { AuthDeliveryService } from './auth-delivery.service.js';
import {
  RequestUser,
  RoleCode,
} from '../authorization/authorization.constants.js';

export const DUMMY_PASSWORD_HASH =
  '$2b$12$4FIQ4hGGuBMG0SSap5M34umEXBLgaucKZSyAR2xEZcSAfiloHZIYG';

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const EMAIL_CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 5 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
interface AuthenticatedUser {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  status: AccountStatus;
  phoneVerifiedAt: Date | null;
  emailVerifiedAt: Date | null;
  userRoles: { role: { code: string } }[];
  sellerProfile: { status: string } | null;
}

@Injectable()
export class AuthService {
  private readonly frontendUrl: string;
  private readonly challengeSecret: string;
  private readonly maxOtpAttempts: number;
  private readonly maxLoginFailures: number;
  private readonly loginFailureWindowMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly delivery: AuthDeliveryService,
  ) {
    this.frontendUrl = this.config.get<string>('FRONTEND_URL') ?? '';
    this.challengeSecret = this.config.getOrThrow<string>(
      'AUTH_CHALLENGE_SECRET',
    );
    if (this.challengeSecret.length < 32) {
      throw new Error('AUTH_CHALLENGE_SECRET must be at least 32 characters.');
    }
    this.maxOtpAttempts = Number(
      this.config.get<string>('AUTH_OTP_MAX_ATTEMPTS') ?? 5,
    );
    if (
      !Number.isInteger(this.maxOtpAttempts) ||
      this.maxOtpAttempts < 1 ||
      this.maxOtpAttempts > 5
    ) {
      throw new Error('AUTH_OTP_MAX_ATTEMPTS must be an integer from 1 to 5.');
    }

    const maxLoginFailuresRaw = this.firstConfigValue([
      'AUTH_LOGIN_MAX_FAILURES',
      'AUTH_LOGIN_MAX_ATTEMPTS',
      'AUTH_ACCOUNT_LOCKOUT_MAX_FAILURES',
    ]);
    this.maxLoginFailures =
      maxLoginFailuresRaw === undefined ? 5 : Number(maxLoginFailuresRaw);
    if (
      !Number.isInteger(this.maxLoginFailures) ||
      this.maxLoginFailures < 1 ||
      this.maxLoginFailures > 20
    ) {
      throw new Error(
        'AUTH_LOGIN_MAX_FAILURES must be an integer from 1 to 20.',
      );
    }

    const loginWindowRaw = this.firstConfigValue([
      'AUTH_LOGIN_FAILURE_WINDOW_MINUTES',
      'AUTH_LOGIN_LOCKOUT_MINUTES',
      'AUTH_ACCOUNT_LOCKOUT_MINUTES',
    ]);
    const loginWindowMinutes =
      loginWindowRaw === undefined ? 15 : Number(loginWindowRaw);
    if (
      !Number.isInteger(loginWindowMinutes) ||
      loginWindowMinutes < 1 ||
      loginWindowMinutes > 1440
    ) {
      throw new Error(
        'AUTH_LOGIN_FAILURE_WINDOW_MINUTES must be an integer from 1 to 1440.',
      );
    }
    this.loginFailureWindowMs = loginWindowMinutes * 60 * 1000;
  }

  async register(input: RegisterDto): Promise<{ message: string }> {
    this.delivery.assertEmailAndSmsConfigured();
    const email = input.email.trim().toLowerCase();
    const phone = this.normalizePhone(input.phone);
    const [emailExists, phoneExists] = await Promise.all([
      this.prisma.user.findUnique({ where: { email }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { phone }, select: { id: true } }),
    ]);

    if (emailExists || phoneExists) {
      throw new ConflictException(
        'Email or phone number is already registered.',
      );
    }

    const passwordHash = await this.hashPassword(input.password);
    const emailToken = randomBytes(32).toString('base64url');
    const phoneCode = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const now = new Date();

    let user: { id: string };
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await createUserWithRole(tx, RoleCode.BUYER, {
          email,
          phone,
          passwordHash,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          termsAcceptedAt: now,
          termsVersion: input.termsVersion,
        });

        await tx.authChallenge.createMany({
          data: [
            {
              userId: created.id,
              type: AuthChallengeType.EMAIL_VERIFICATION,
              tokenHash: this.hashToken(emailToken),
              expiresAt: new Date(now.getTime() + EMAIL_CHALLENGE_TTL_MS),
            },
            {
              userId: created.id,
              type: AuthChallengeType.PHONE_VERIFICATION,
              tokenHash: this.hashOtp(created.id, phoneCode),
              expiresAt: new Date(now.getTime() + OTP_TTL_MS),
            },
          ],
        });

        await tx.authAuditEvent.createMany({
          data: [{ userId: created.id, eventType: 'ACCOUNT_REGISTERED' }],
        });

        return created;
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        throw new ConflictException(
          'Email or phone number is already registered.',
        );
      }
      throw error;
    }

    await Promise.all([
      this.delivery.sendEmail({
        event: 'verify-email',
        recipient: email,
        token: emailToken,
        verificationUrl: this.buildFrontendUrl('verify-email', emailToken),
        expiresInSeconds: EMAIL_CHALLENGE_TTL_MS / 1000,
      }),
      this.delivery.sendSms({
        event: 'verify-phone',
        recipient: phone,
        token: phoneCode,
        expiresInSeconds: OTP_TTL_MS / 1000,
      }),
    ]);
    await this.prisma.authAuditEvent.createMany({
      data: [
        { userId: user.id, eventType: 'EMAIL_VERIFICATION_SENT' },
        { userId: user.id, eventType: 'PHONE_VERIFICATION_SENT' },
      ],
    });

    return {
      message:
        'Complete email and phone verification to activate your account.',
    };
  }

  async login(identifier: string, password: string) {
    const trimmedIdentifier = identifier.trim();
    const isEmailIdentifier = trimmedIdentifier.includes('@');
    const user = await this.prisma.user.findFirst({
      where: isEmailIdentifier
        ? { email: trimmedIdentifier.toLowerCase() }
        : { phone: this.normalizePhone(trimmedIdentifier) },
      include: {
        userRoles: { include: { role: { select: { code: true } } } },
        sellerProfile: { select: { status: true } },
      },
    });

    if (user) {
      const recentFailures = await this.prisma.authAuditEvent.count({
        where: {
          userId: user.id,
          eventType: 'LOGIN_FAILED',
          createdAt: { gt: new Date(Date.now() - this.loginFailureWindowMs) },
        },
      });
      if (recentFailures >= this.maxLoginFailures) {
        throw new HttpException(
          'Too many login attempts. Try again later.',
          429,
        );
      }
    }

    const passwordHash = user ? user.passwordHash : DUMMY_PASSWORD_HASH;
    const passwordValid = await bcrypt.compare(password, passwordHash);
    if (!user || !passwordValid) {
      await this.recordAudit(user?.id, 'LOGIN_FAILED');
      throw new UnauthorizedException('Invalid credentials.');
    }

    if (user.status !== AccountStatus.ACTIVE) {
      await this.recordAudit(user.id, 'LOGIN_BLOCKED_INACTIVE_ACCOUNT');
      throw new UnauthorizedException(
        'Account is not active. Complete verification or contact support.',
      );
    }

    const isAdmin = user.userRoles.some(
      ({ role }) => role.code === RoleCode.ADMIN,
    );
    if (isAdmin) {
      if (!user.phone || !user.phoneVerifiedAt) {
        throw new UnauthorizedException(
          'Administrator accounts require a verified phone number for MFA.',
        );
      }
      this.delivery.assertSmsConfigured();

      const recentChallenges = await this.prisma.authChallenge.count({
        where: {
          userId: user.id,
          type: AuthChallengeType.ADMIN_LOGIN_MFA,
          createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) },
        },
      });
      if (recentChallenges >= 3) {
        throw new UnauthorizedException(
          'Administrator verification is temporarily unavailable.',
        );
      }

      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      await this.replaceChallenge(
        user.id,
        AuthChallengeType.ADMIN_LOGIN_MFA,
        this.hashOtp(user.id, code, AuthChallengeType.ADMIN_LOGIN_MFA),
        new Date(Date.now() + OTP_TTL_MS),
      );
      await this.recordAudit(user.id, 'ADMIN_MFA_CHALLENGE_CREATED');
      await this.delivery.sendSms({
        event: 'admin-login-mfa',
        recipient: user.phone,
        token: code,
        expiresInSeconds: OTP_TTL_MS / 1000,
      });

      return {
        mfaRequired: true,
        message: 'A sign-in code was sent to the administrator phone number.',
      };
    }

    return this.createSession(user);
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    const challenge = await this.prisma.authChallenge.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: {
        user: {
          select: { id: true, phoneVerifiedAt: true, status: true },
        },
      },
    });

    if (
      !challenge ||
      challenge.type !== AuthChallengeType.EMAIL_VERIFICATION ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date()
    ) {
      throw new BadRequestException('Verification link is invalid or expired.');
    }

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException(
          'Verification link is invalid or expired.',
        );
      }

      const user = await tx.user.update({
        where: { id: challenge.user.id },
        data: {
          emailVerifiedAt: new Date(),
          ...(challenge.user.phoneVerifiedAt &&
          challenge.user.status === AccountStatus.PENDING_VERIFICATION
            ? { status: AccountStatus.ACTIVE }
            : {}),
        },
        select: { id: true },
      });
      await tx.authAuditEvent.create({
        data: { userId: user.id, eventType: 'EMAIL_VERIFIED' },
      });
    });

    return { message: 'Email verified.' };
  }

  async verifyPhone(phone: string, code: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { phone: this.normalizePhone(phone) },
      select: {
        id: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        status: true,
      },
    });
    if (!user || user.phoneVerifiedAt) {
      throw new BadRequestException('Verification code is invalid or expired.');
    }

    const challenge = await this.prisma.authChallenge.findFirst({
      where: {
        userId: user.id,
        type: AuthChallengeType.PHONE_VERIFICATION,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge || challenge.attempts >= this.maxOtpAttempts) {
      throw new BadRequestException('Verification code is invalid or expired.');
    }

    const expectedHash = Buffer.from(this.hashOtp(user.id, code.trim()), 'hex');
    const storedHash = Buffer.from(challenge.tokenHash, 'hex');
    const validCode =
      expectedHash.length === storedHash.length &&
      timingSafeEqual(expectedHash, storedHash);
    if (!validCode) {
      const updated = await this.prisma.authChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
          attempts: { lt: this.maxOtpAttempts },
        },
        data: { attempts: { increment: 1 } },
      });
      await this.recordAudit(user.id, 'PHONE_VERIFICATION_FAILED');
      if (updated.count === 0) {
        throw new BadRequestException(
          'Verification code is invalid or expired.',
        );
      }
      throw new BadRequestException('Verification code is invalid.');
    }

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
          attempts: { lt: this.maxOtpAttempts },
        },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException(
          'Verification code is invalid or expired.',
        );
      }

      await tx.user.update({
        where: { id: user.id },
        data: {
          phoneVerifiedAt: new Date(),
          ...(user.emailVerifiedAt &&
          user.status === AccountStatus.PENDING_VERIFICATION
            ? { status: AccountStatus.ACTIVE }
            : {}),
        },
      });
      await tx.authAuditEvent.create({
        data: { userId: user.id, eventType: 'PHONE_VERIFIED' },
      });
    });

    return { message: 'Phone number verified.' };
  }

  async verifyAdminMfa(phone: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { phone: this.normalizePhone(phone) },
      include: {
        userRoles: { include: { role: { select: { code: true } } } },
        sellerProfile: { select: { status: true } },
      },
    });
    const isAdmin = user?.userRoles.some(
      ({ role }) => role.code === RoleCode.ADMIN,
    );
    if (
      !user ||
      !isAdmin ||
      user.status !== AccountStatus.ACTIVE ||
      !user.phoneVerifiedAt
    ) {
      throw new UnauthorizedException('Administrator verification failed.');
    }

    const recentMfaFailures = await this.prisma.authAuditEvent.count({
      where: {
        userId: user.id,
        eventType: 'ADMIN_MFA_FAILED',
        createdAt: { gt: new Date(Date.now() - this.loginFailureWindowMs) },
      },
    });
    if (recentMfaFailures >= this.maxLoginFailures) {
      throw new HttpException(
        'Too many login attempts. Try again later.',
        429,
      );
    }

    const challenge = await this.prisma.authChallenge.findFirst({
      where: {
        userId: user.id,
        type: AuthChallengeType.ADMIN_LOGIN_MFA,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge || challenge.attempts >= this.maxOtpAttempts) {
      throw new UnauthorizedException('Administrator verification failed.');
    }

    const expectedHash = Buffer.from(
      this.hashOtp(user.id, code.trim(), AuthChallengeType.ADMIN_LOGIN_MFA),
      'hex',
    );
    const storedHash = Buffer.from(challenge.tokenHash, 'hex');
    const validCode =
      expectedHash.length === storedHash.length &&
      timingSafeEqual(expectedHash, storedHash);
    if (!validCode) {
      await this.prisma.authChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
          attempts: { lt: this.maxOtpAttempts },
        },
        data: { attempts: { increment: 1 } },
      });
      await this.recordAudit(user.id, 'ADMIN_MFA_FAILED');
      throw new UnauthorizedException('Administrator verification failed.');
    }

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
          attempts: { lt: this.maxOtpAttempts },
        },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException('Administrator verification failed.');
      }
      await tx.authAuditEvent.create({
        data: { userId: user.id, eventType: 'ADMIN_MFA_SUCCEEDED' },
      });
    });

    return this.createSession(user);
  }

  async resendPhoneVerification(phone: string): Promise<{ message: string }> {
    const genericResponse = {
      message: 'If the account can be verified, a new code will be sent.',
    };
    const user = await this.prisma.user.findUnique({
      where: { phone: this.normalizePhone(phone) },
      select: { id: true, phoneVerifiedAt: true },
    });
    if (!user || user.phoneVerifiedAt) {
      return genericResponse;
    }

    const recentChallenges = await this.prisma.authChallenge.count({
      where: {
        userId: user.id,
        type: AuthChallengeType.PHONE_VERIFICATION,
        createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) },
      },
    });
    if (recentChallenges >= 3) {
      return genericResponse;
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.replaceChallenge(
      user.id,
      AuthChallengeType.PHONE_VERIFICATION,
      this.hashOtp(user.id, code),
      new Date(Date.now() + OTP_TTL_MS),
    );
    try {
      await this.delivery.sendSms({
        event: 'verify-phone',
        recipient: this.normalizePhone(phone),
        token: code,
        expiresInSeconds: OTP_TTL_MS / 1000,
      });
      await this.recordAudit(user.id, 'PHONE_VERIFICATION_SENT');
    } catch {
      await this.recordAudit(user.id, 'PHONE_VERIFICATION_DELIVERY_FAILED');
    }
    return genericResponse;
  }

  async resendEmailVerification(
    emailInput: string,
  ): Promise<{ message: string }> {
    const genericResponse = {
      message: 'If the account can be verified, a new link will be sent.',
    };
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true },
    });
    if (!user || user.emailVerifiedAt) {
      return genericResponse;
    }

    const recentChallenges = await this.prisma.authChallenge.count({
      where: {
        userId: user.id,
        type: AuthChallengeType.EMAIL_VERIFICATION,
        createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) },
      },
    });
    if (recentChallenges >= 3) {
      return genericResponse;
    }

    const token = randomBytes(32).toString('base64url');
    await this.replaceChallenge(
      user.id,
      AuthChallengeType.EMAIL_VERIFICATION,
      this.hashToken(token),
      new Date(Date.now() + EMAIL_CHALLENGE_TTL_MS),
    );

    try {
      await this.delivery.sendEmail({
        event: 'verify-email',
        recipient: email,
        token,
        verificationUrl: this.buildFrontendUrl('verify-email', token),
        expiresInSeconds: EMAIL_CHALLENGE_TTL_MS / 1000,
      });
      await this.recordAudit(user.id, 'EMAIL_VERIFICATION_SENT');
    } catch {
      await this.recordAudit(user.id, 'EMAIL_VERIFICATION_DELIVERY_FAILED');
    }
    return genericResponse;
  }

  async requestPasswordReset(
    input: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    const genericResponse = {
      message:
        'If an account exists for that address, recovery instructions will be sent.',
    };
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true },
    });
    if (!user || !user.emailVerifiedAt) {
      return genericResponse;
    }

    const recentChallenges = await this.prisma.authChallenge.count({
      where: {
        userId: user.id,
        type: AuthChallengeType.PASSWORD_RESET,
        createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) },
      },
    });
    if (recentChallenges >= 3) {
      return genericResponse;
    }

    const token = randomBytes(32).toString('base64url');
    await this.replaceChallenge(
      user.id,
      AuthChallengeType.PASSWORD_RESET,
      this.hashToken(token),
      new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    );
    await this.recordAudit(user.id, 'PASSWORD_RESET_REQUESTED');
    try {
      await this.delivery.sendEmail({
        event: 'reset-password',
        recipient: email,
        token,
        verificationUrl: this.buildFrontendUrl('reset-password', token),
        expiresInSeconds: PASSWORD_RESET_TTL_MS / 1000,
      });
    } catch {
      await this.recordAudit(user.id, 'PASSWORD_RESET_DELIVERY_FAILED');
    }
    return genericResponse;
  }

  async resetPassword(input: ResetPasswordDto): Promise<{ message: string }> {
    const challenge = await this.prisma.authChallenge.findUnique({
      where: { tokenHash: this.hashToken(input.token) },
      select: {
        id: true,
        userId: true,
        type: true,
        expiresAt: true,
        consumedAt: true,
      },
    });
    if (
      !challenge ||
      challenge.type !== AuthChallengeType.PASSWORD_RESET ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date()
    ) {
      throw new BadRequestException(
        'Password reset link is invalid or expired.',
      );
    }

    const passwordHash = await this.hashPassword(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException(
          'Password reset link is invalid or expired.',
        );
      }

      await tx.user.update({
        where: { id: challenge.userId },
        data: { passwordHash },
      });
      await tx.authSession.updateMany({
        where: { userId: challenge.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.authChallenge.updateMany({
        where: {
          userId: challenge.userId,
          type: AuthChallengeType.PASSWORD_RESET,
          consumedAt: null,
        },
        data: { consumedAt: new Date() },
      });
      await tx.authAuditEvent.create({
        data: {
          userId: challenge.userId,
          eventType: 'PASSWORD_RESET_COMPLETED',
        },
      });
    });

    return { message: 'Password reset. Sign in using the new password.' };
  }

  async logout(user: RequestUser): Promise<{ message: string }> {
    if (!user.sessionId) {
      throw new UnauthorizedException('Session is invalid.');
    }
    await this.prisma.authSession.updateMany({
      where: { id: user.sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.recordAudit(user.id, 'LOGOUT_SUCCEEDED');
    return { message: 'Logged out.' };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: { include: { role: { select: { code: true } } } },
        sellerProfile: { select: { status: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('Account not found.');
    }
    return this.toPublicUser(user);
  }

  async updateProfile(userId: string, input: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
      },
      include: {
        userRoles: { include: { role: { select: { code: true } } } },
        sellerProfile: { select: { status: true } },
      },
    });
    await this.recordAudit(userId, 'PROFILE_UPDATED');
    return this.toPublicUser(user);
  }

  async loadAuthenticatedUser(userId: string, sessionId: string) {
    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      include: {
        user: {
          include: {
            userRoles: { include: { role: { select: { code: true } } } },
            sellerProfile: { select: { status: true } },
          },
        },
      },
    });

    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== AccountStatus.ACTIVE
    ) {
      return undefined;
    }

    return this.toRequestUser(session.user, session.id);
  }

  async recordAudit(
    userId: string | undefined,
    eventType: string,
  ): Promise<void> {
    await this.prisma.authAuditEvent.create({
      data: userId ? { userId, eventType } : { eventType },
    });
  }

  private firstConfigValue(keys: string[]): string | undefined {
    for (const key of keys) {
      const value = this.config.get<string>(key);
      if (value !== undefined && value !== null) {
        return value;
      }
    }
    return undefined;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async hashPassword(password: string): Promise<string> {
    return hashPassword(password);
  }

  private async replaceChallenge(
    userId: string,
    type: AuthChallengeType,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.authChallenge.updateMany({
        where: { userId, type, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.authChallenge.create({
        data: { userId, type, tokenHash, expiresAt },
      });
    });
  }

  private hashOtp(
    userId: string,
    code: string,
    type: AuthChallengeType = AuthChallengeType.PHONE_VERIFICATION,
  ): string {
    return createHmac('sha256', this.challengeSecret)
      .update(`${userId}:${type}:${code}`)
      .digest('hex');
  }

  private async createSession(user: AuthenticatedUser) {
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
    const session = await this.prisma.authSession.create({
      data: { userId: user.id, expiresAt },
      select: { id: true },
    });

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      sid: session.id,
    });

    await this.recordAudit(user.id, 'LOGIN_SUCCEEDED');

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_MS / 1000,
      user: this.toPublicUser(user),
    };
  }

  private buildFrontendUrl(path: string, token: string): string | undefined {
    if (!this.frontendUrl) {
      return undefined;
    }
    return `${this.frontendUrl.replace(/\/$/, '')}/${path}?token=${encodeURIComponent(token)}`;
  }

  private normalizePhone(phone: string): string {
    const parsed = parsePhoneNumberFromString(phone, 'ET');
    if (!parsed || !parsed.isValid()) {
      throw new BadRequestException('Phone number is invalid.');
    }
    return parsed.number;
  }

  private toRequestUser(
    user: AuthenticatedUser,
    sessionId?: string,
  ): RequestUser {
    return {
      id: user.id,
      roles: user.userRoles.map(
        ({ role }) => role.code as RequestUser['roles'][number],
      ),
      status: user.status,
      sellerStatus: user.sellerProfile?.status as RequestUser['sellerStatus'],
      sessionId,
    };
  }

  private toPublicUser(user: AuthenticatedUser) {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      emailVerified: !!user.emailVerifiedAt,
      phoneVerified: !!user.phoneVerifiedAt,
      roles: user.userRoles.map(({ role }) => role.code),
      sellerStatus: user.sellerProfile?.status ?? null,
    };
  }
}
