import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { AuthChallengeType } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const CHALLENGE_SECRET = 'unit-test-challenge-secret-at-least-32-characters';

function createService(
  prismaOverrides: Record<string, unknown> = {},
  configOverrides: Record<string, string> = {},
) {
  const authSessionCreate = vi.fn().mockResolvedValue({ id: 'session-1' });
  const createChallenges = vi.fn();
  const transactionChallengeUpdateMany = vi
    .fn()
    .mockResolvedValue({ count: 1 });
  const transactionChallengeCreate = vi.fn().mockResolvedValue({});
  const jwt = { signAsync: vi.fn().mockResolvedValue('signed-access-token') };
  const transaction = vi.fn(
    async (callback: (transaction: unknown) => unknown) =>
      callback({
        role: { upsert: vi.fn().mockResolvedValue({ id: 'buyer-role' }) },
        authChallenge: {
          createMany: createChallenges,
          create: transactionChallengeCreate,
          updateMany: transactionChallengeUpdateMany,
        },
        user: {
          create: vi.fn().mockResolvedValue({ id: 'user-1' }),
          update: vi.fn().mockResolvedValue({ id: 'user-1' }),
        },
        authAuditEvent: {
          create: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      }),
  );
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      ...(prismaOverrides.user as object),
    },
    authChallenge: {
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn(),
      ...(prismaOverrides.authChallenge as object),
    },
    authSession: {
      create: authSessionCreate,
      ...(prismaOverrides.authSession as object),
    },
    authAuditEvent: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
      ...(prismaOverrides.authAuditEvent as object),
    },
    $transaction: transaction,
  } as unknown as PrismaService;

  const config = {
    get: vi.fn((key: string) =>
      configOverrides[key] ??
        (key === 'AUTH_OTP_MAX_ATTEMPTS'
          ? '5'
          : 'https://frontend.example'),
    ),
    getOrThrow: vi.fn(() => CHALLENGE_SECRET),
  };
  const delivery = {
    assertEmailAndSmsConfigured: vi.fn(),
    assertSmsConfigured: vi.fn(),
    sendEmail: vi.fn().mockResolvedValue(undefined),
    sendSms: vi.fn().mockResolvedValue(undefined),
  };
  const service = new AuthService(
    prisma,
    jwt as never,
    config as never,
    delivery as never,
  );
  return {
    service,
    prisma,
    authSessionCreate,
    transaction,
    createChallenges,
    transactionChallengeUpdateMany,
    transactionChallengeCreate,
    delivery,
    jwt,
  };
}

describe('AuthService', () => {
  it('registers a pending buyer and stores only hashed verification challenges', async () => {
    const { service, createChallenges, delivery } = createService();

    await expect(
      service.register({
        email: 'Buyer@example.com',
        phone: '+251 911 234 567',
        password: 'strong-test-password',
        firstName: ' Buyer ',
        lastName: ' Example ',
        acceptedTerms: true,
        termsVersion: 'terms-2026-10',
      }),
    ).resolves.toEqual({
      message:
        'Complete email and phone verification to activate your account.',
    });

    expect(createChallenges).toHaveBeenCalledOnce();
    const challenges = createChallenges.mock.calls[0][0].data;
    expect(challenges).toHaveLength(2);
    expect(
      challenges.map(({ tokenHash }: { tokenHash: string }) => tokenHash),
    ).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
    expect(delivery.sendSms).toHaveBeenCalledOnce();
    expect(delivery.sendEmail).toHaveBeenCalledOnce();
  });

  it('activates the user after consuming a valid phone OTP', async () => {
    const code = '583014';
    const tokenHash = createHmac('sha256', CHALLENGE_SECRET)
      .update(`user-1:${AuthChallengeType.PHONE_VERIFICATION}:${code}`)
      .digest('hex');
    const { service, transaction } = createService({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          phoneVerifiedAt: null,
          emailVerifiedAt: null,
        }),
      },
      authChallenge: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'challenge-1',
          tokenHash,
          attempts: 0,
          consumedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
    });

    await expect(service.verifyPhone('+251911234567', code)).resolves.toEqual({
      message: 'Phone number verified.',
    });
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('increments the persisted OTP attempt count for an invalid code', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const { service } = createService({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          phoneVerifiedAt: null,
          emailVerifiedAt: null,
        }),
      },
      authChallenge: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'challenge-1',
          tokenHash: '0'.repeat(64),
          attempts: 0,
          consumedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        updateMany,
      },
    });

    await expect(
      service.verifyPhone('+251911234567', '111111'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'challenge-1',
          attempts: { lt: 5 },
        }),
        data: { attempts: { increment: 1 } },
      }),
    );
  });

  it('rejects a phone OTP after the configured attempt limit', async () => {
    const { service, transaction } = createService({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          phoneVerifiedAt: null,
          emailVerifiedAt: null,
        }),
      },
      authChallenge: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'challenge-1',
          tokenHash: '0'.repeat(64),
          attempts: 5,
          consumedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
    });

    await expect(
      service.verifyPhone('+251911234567', '111111'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not allow OTP configuration to exceed five attempts', () => {
    expect(() =>
      createService({}, { AUTH_OTP_MAX_ATTEMPTS: '6' }),
    ).toThrow('AUTH_OTP_MAX_ATTEMPTS must be an integer from 1 to 5.');
  });

  it('invalidates an active phone challenge before creating its replacement', async () => {
    const {
      service,
      transactionChallengeUpdateMany,
      transactionChallengeCreate,
    } = createService({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          phoneVerifiedAt: null,
        }),
      },
    });

    await service.resendPhoneVerification('+251911234567');

    expect(transactionChallengeUpdateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        type: AuthChallengeType.PHONE_VERIFICATION,
        consumedAt: null,
      },
      data: { consumedAt: expect.any(Date) },
    });
    expect(transactionChallengeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        type: AuthChallengeType.PHONE_VERIFICATION,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    expect(
      transactionChallengeUpdateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(transactionChallengeCreate.mock.invocationCallOrder[0]);
  });

  it('rate limits password recovery per account without disclosing account status', async () => {
    const create = vi.fn();
    const { service, transaction } = createService({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          emailVerifiedAt: new Date(),
        }),
      },
      authChallenge: {
        count: vi.fn().mockResolvedValue(3),
        create,
      },
    });

    await expect(
      service.requestPasswordReset({ email: 'buyer@example.com' }),
    ).resolves.toEqual({
      message:
        'If an account exists for that address, recovery instructions will be sent.',
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects passwords that exceed bcrypt's UTF-8 byte limit", async () => {
    const { service, transaction } = createService({
      authChallenge: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'reset-challenge',
          userId: 'user-1',
          type: AuthChallengeType.PASSWORD_RESET,
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: null,
        }),
      },
    });

    await expect(
      service.resetPassword({
        token: 'reset-token',
        newPassword: 'a'.repeat(73),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not issue a session for an account pending verification', async () => {
    const passwordHash = await bcrypt.hash('strong-test-password', 4);
    const { service, authSessionCreate } = createService({
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'user-1',
          email: 'buyer@example.com',
          phone: '+251911234567',
          passwordHash,
          status: 'PENDING_VERIFICATION',
          userRoles: [],
          sellerProfile: null,
        }),
      },
    });

    await expect(
      service.login('buyer@example.com', 'strong-test-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authSessionCreate).not.toHaveBeenCalled();
  });

  it('normalizes local Ethiopian phone numbers before account lookup', async () => {
    const passwordHash = await bcrypt.hash('strong-test-password', 4);
    const findFirst = vi.fn().mockResolvedValue({
      id: 'buyer-1',
      email: 'buyer@example.com',
      phone: '+251911234567',
      firstName: 'Buyer',
      lastName: 'One',
      passwordHash,
      status: 'ACTIVE',
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
      userRoles: [{ role: { code: 'BUYER' } }],
      sellerProfile: null,
    });
    const { service } = createService({ user: { findFirst } });

    await service.login('0911 234 567', 'strong-test-password');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phone: '+251911234567' } }),
    );
  });

  it('requires a phone MFA challenge before issuing an administrator session', async () => {
    const passwordHash = await bcrypt.hash('strong-test-password', 4);
    const { service, authSessionCreate, delivery } = createService({
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'admin-1',
          email: 'admin@example.com',
          phone: '+251911234567',
          passwordHash,
          status: 'ACTIVE',
          phoneVerifiedAt: new Date(),
          emailVerifiedAt: new Date(),
          userRoles: [{ role: { code: 'ADMIN' } }],
          sellerProfile: null,
        }),
      },
    });

    await expect(
      service.login('admin@example.com', 'strong-test-password'),
    ).resolves.toMatchObject({ mfaRequired: true });
    expect(delivery.sendSms).toHaveBeenCalledOnce();
    expect(authSessionCreate).not.toHaveBeenCalled();
  });

  it('issues an administrator session only after valid MFA verification', async () => {
    const code = '583014';
    const tokenHash = createHmac('sha256', CHALLENGE_SECRET)
      .update(`admin-1:${AuthChallengeType.ADMIN_LOGIN_MFA}:${code}`)
      .digest('hex');
    const { service, authSessionCreate, jwt } = createService({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'admin-1',
          email: 'admin@example.com',
          phone: '+251911234567',
          firstName: 'Admin',
          lastName: 'User',
          status: 'ACTIVE',
          phoneVerifiedAt: new Date(),
          emailVerifiedAt: new Date(),
          userRoles: [{ role: { code: 'ADMIN' } }],
          sellerProfile: null,
        }),
      },
      authChallenge: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'mfa-challenge-1',
          tokenHash,
          attempts: 0,
          consumedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
    });

    await expect(
      service.verifyAdminMfa('+251911234567', code),
    ).resolves.toMatchObject({ accessToken: 'signed-access-token' });
    expect(authSessionCreate).toHaveBeenCalledOnce();
    expect(jwt.signAsync).toHaveBeenCalledOnce();
  });

  it('rejects duplicate email or phone registration and invalid credentials', async () => {
    const { service } = createService({
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'existing-user' }),
      },
    });

    await expect(
      service.register({
        email: 'buyer@example.com',
        phone: '+251911234567',
        password: 'strong-test-password',
        firstName: 'Buyer',
        lastName: 'One',
        acceptedTerms: true,
        termsVersion: 'v1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const passwordHash = await bcrypt.hash('correct-password', 4);
    const { service: loginService } = createService({
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'user-1',
          email: 'buyer@example.com',
          phone: '+251911234567',
          passwordHash,
          status: 'ACTIVE',
          phoneVerifiedAt: new Date(),
          emailVerifiedAt: new Date(),
          userRoles: [{ role: { code: 'BUYER' } }],
          sellerProfile: null,
        }),
      },
    });

    await expect(
      loginService.login('buyer@example.com', 'wrong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects invalid, expired, or reused email verification tokens', async () => {
    const { service } = createService({
      authChallenge: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'challenge-1',
          user: { id: 'user-1', phoneVerifiedAt: null, status: 'PENDING_VERIFICATION' },
          type: AuthChallengeType.EMAIL_VERIFICATION,
          consumedAt: new Date(Date.now() - 60_000),
          expiresAt: new Date(Date.now() - 60_000),
        }),
      },
    });

    await expect(service.verifyEmail('expired-token')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const { service: validService } = createService({
      authChallenge: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'challenge-2',
          user: { id: 'user-1', phoneVerifiedAt: null, status: 'PENDING_VERIFICATION' },
          type: AuthChallengeType.EMAIL_VERIFICATION,
          consumedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
    });

    await expect(validService.verifyEmail('valid-token')).resolves.toEqual({
      message: 'Email verified.',
    });
  });

  it('revokes the current session on logout and rejects missing or revoked sessions', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const { service } = createService({
      authSession: {
        updateMany,
      },
      authAuditEvent: {
        create: vi.fn().mockResolvedValue({}),
      },
    });

    await expect(
      service.logout({ id: 'user-1', roles: ['BUYER'], status: 'ACTIVE', sessionId: 'session-1' }),
    ).resolves.toEqual({ message: 'Logged out.' });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });

    const loadService = new AuthService(
      {
        authSession: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      } as never,
      { signAsync: vi.fn() } as never,
      { get: vi.fn(), getOrThrow: vi.fn(() => CHALLENGE_SECRET) } as never,
      { assertEmailAndSmsConfigured: vi.fn() } as never,
    );

    await expect(loadService.loadAuthenticatedUser('user-1', 'missing-session')).resolves.toBeUndefined();
  });
});
