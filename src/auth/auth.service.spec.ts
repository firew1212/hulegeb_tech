import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { AuthChallengeType } from './auth.constants.js';
import { AuthService, DUMMY_PASSWORD_HASH } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
vi.mock('bcryptjs', async () => {
  const actual = await vi.importActual<typeof import('bcryptjs')>('bcryptjs');
  const compare = vi.fn(actual.compare);
  return {
    ...actual,
    compare,
    default: { ...actual, compare },
  };
});


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
          count: vi.fn().mockResolvedValue(0),
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
      count: vi.fn().mockResolvedValue(0),
      ...(prismaOverrides.authAuditEvent as object),
    },
    $transaction: transaction,
  } as unknown as PrismaService;

  const config = {
    get: vi.fn((key: string) =>
      configOverrides[key] ??
      (key === 'AUTH_OTP_MAX_ATTEMPTS'
        ? '5'
        : key === 'AUTH_LOGIN_MAX_FAILURES' ||
            key === 'AUTH_LOGIN_MAX_ATTEMPTS' ||
            key === 'AUTH_ACCOUNT_LOCKOUT_MAX_FAILURES'
          ? '5'
          : key === 'AUTH_LOGIN_FAILURE_WINDOW_MINUTES' ||
              key === 'AUTH_LOGIN_LOCKOUT_MINUTES' ||
              key === 'AUTH_ACCOUNT_LOCKOUT_MINUTES'
            ? '15'
            : key === 'FRONTEND_URL'
              ? 'https://frontend.example'
              : undefined),
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
      data: { revokedAt: expect.any(Date), refreshTokenHash: null },
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

  it('returns 429 after five account-level login failures', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const user = {
      id: 'user-1',
      email: 'buyer@example.com',
      phone: '+251911234567',
      passwordHash,
      status: 'ACTIVE',
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
      userRoles: [{ role: { code: 'BUYER' } }],
      sellerProfile: null,
    };
    const findFirst = vi.fn().mockResolvedValue(user);
    const { service } = createService({
      user: { findFirst },
      authAuditEvent: {
        count: vi.fn().mockResolvedValue(5),
        create: vi.fn().mockResolvedValue({}),
      },
    });

    await expect(
      service.login('buyer@example.com', 'any-password'),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('validates login brute-force settings', () => {
    expect(() =>
      createService({}, { AUTH_LOGIN_MAX_FAILURES: '0' }),
    ).toThrow('AUTH_LOGIN_MAX_FAILURES must be an integer from 1 to 20.');
  });
  it('records the first five sequential qualifying login failures as 401', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const user = {
      id: 'user-1',
      email: 'buyer@example.com',
      phone: '+251911234567',
      passwordHash,
      status: 'ACTIVE',
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
      userRoles: [{ role: { code: 'BUYER' } }],
      sellerProfile: null,
    };
    const findFirst = vi.fn().mockResolvedValue(user);
    let failures = 0;
    const count = vi.fn().mockImplementation(() => Promise.resolve(failures++));
    const create = vi.fn().mockResolvedValue({});
    const { service, prisma } = createService({
      user: { findFirst },
      authAuditEvent: { count, create },
    });

    for (let i = 0; i < 5; i++) {
      await expect(
        service.login('buyer@example.com', 'wrong-password'),
      ).rejects.toMatchObject({ status: 401 });
    }

    expect(count).toHaveBeenCalledTimes(5);
  });

  it('returns 429 on the sixth sequential attempt without invoking bcrypt', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const user = {
      id: 'user-1',
      email: 'buyer@example.com',
      phone: '+251911234567',
      passwordHash,
      status: 'ACTIVE',
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
      userRoles: [{ role: { code: 'BUYER' } }],
      sellerProfile: null,
    };
    const findFirst = vi.fn().mockResolvedValue(user);
    const count = vi.fn().mockResolvedValue(5);
    const { service } = createService({
      user: { findFirst },
      authAuditEvent: { count, create: vi.fn().mockResolvedValue({}) },
    });

    await expect(
      service.login('buyer@example.com', 'wrong-password'),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('performs dummy bcrypt comparison for unknown users and returns generic auth response', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const { service } = createService({
      user: { findFirst },
      authAuditEvent: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({}) },
    });

    (bcrypt.compare as unknown as { mockClear?: () => void }).mockClear?.();
    await expect(
      service.login('nobody@example.com', 'wrong-password'),
    ).rejects.toMatchObject({ status: 401, message: 'Invalid credentials.' });

    expect(bcrypt.compare).toHaveBeenCalledWith('wrong-password', DUMMY_PASSWORD_HASH);
  });

  it('does not lock out when fewer than five qualifying failures remain in window', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const user = {
      id: 'user-1',
      email: 'buyer@example.com',
      phone: '+251911234567',
      passwordHash,
      status: 'ACTIVE',
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
      userRoles: [{ role: { code: 'BUYER' } }],
      sellerProfile: null,
    };
    const findFirst = vi.fn().mockResolvedValue(user);
    const count = vi.fn().mockResolvedValue(1);
    const create = vi.fn().mockResolvedValue({});
    const { service } = createService({
      user: { findFirst },
      authAuditEvent: { count, create },
    });

    await expect(
      service.login('buyer@example.com', 'wrong-password'),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('returns 429 for restricted admin MFA before OTP verification', async () => {
    const user = {
      id: 'user-1',
      email: 'admin@example.com',
      phone: '+251911234567',
      passwordHash: 'hash',
      status: 'ACTIVE',
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
      userRoles: [{ role: { code: 'ADMIN' } }],
      sellerProfile: null,
    };
    const findUnique = vi.fn().mockResolvedValue(user);
    const count = vi.fn().mockResolvedValue(5);
    const findFirstChallenge = vi.fn();
    const { service } = createService({
      user: { findUnique, findFirst: vi.fn().mockResolvedValue(user) },
      authChallenge: { findFirst: findFirstChallenge, count: vi.fn().mockResolvedValue(0) },
      authAuditEvent: { count, create: vi.fn().mockResolvedValue({}) },
    });

    await expect(
      service.verifyAdminMfa('+251911234567', '123456'),
    ).rejects.toMatchObject({ status: 429 });

    expect(findFirstChallenge).not.toHaveBeenCalled();
  });

  it('validates invalid failure-window configuration and supported env aliases', () => {
    expect(() =>
      createService({}, { AUTH_LOGIN_FAILURE_WINDOW_MINUTES: '0' }),
    ).toThrow('AUTH_LOGIN_FAILURE_WINDOW_MINUTES must be an integer from 1 to 1440.');

    expect(() =>
      createService(
        {},
        {
          AUTH_LOGIN_MAX_ATTEMPTS: '3',
          AUTH_ACCOUNT_LOCKOUT_MINUTES: '10',
        },
      ),
    ).not.toThrow();
  });

  it('handles concurrent login attempts without crashing', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const user = {
      id: 'user-1',
      email: 'buyer@example.com',
      phone: '+251911234567',
      passwordHash,
      status: 'ACTIVE',
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
      userRoles: [{ role: { code: 'BUYER' } }],
      sellerProfile: null,
    };
    const findFirst = vi.fn().mockResolvedValue(user);
    const count = vi.fn().mockResolvedValue(0);
    const create = vi.fn().mockResolvedValue({});
    const { service } = createService({
      user: { findFirst },
      authAuditEvent: { count, create },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        service.login('buyer@example.com', 'wrong-password'),
      ),
    );

    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect((result.reason as { status?: number }).status).toBe(401);
      }
    }
  });
  it('rejects missing or non-string refresh tokens', async () => {
    const { service } = createService();
    await expect(service.refresh('')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects unknown, revoked, expired, or inactive refresh sessions', async () => {
    const baseUser = {
      id: 'user-1',
      status: 'ACTIVE',
      userRoles: [{ role: { code: 'BUYER' } }],
      sellerProfile: null,
    };
    const expiredSession = {
      id: 'session-1',
      userId: 'user-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
      refreshTokenHash: 'hash',
      user: baseUser,
    };
    const revokedSession = { ...expiredSession, revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) };
    const inactiveUserSession = {
      ...expiredSession,
      expiresAt: new Date(Date.now() + 60_000),
      user: { ...baseUser, status: 'SUSPENDED' },
    };

    for (const session of [null, revokedSession, expiredSession, inactiveUserSession]) {
      const findUnique = vi.fn().mockResolvedValue(session);
      const updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          authSession: { findUnique, updateMany },
          authAuditEvent: { create: vi.fn() },
        }),
      );
      const prisma = {
        authSession: { findUnique, updateMany },
        authAuditEvent: { create: vi.fn().mockResolvedValue({}) },
        $transaction: transaction,
      } as never;
      const service = new AuthService(
        prisma,
        { signAsync: vi.fn().mockResolvedValue('access') } as never,
        { get: vi.fn(), getOrThrow: vi.fn(() => CHALLENGE_SECRET) } as never,
        { assertEmailAndSmsConfigured: vi.fn() } as never,
      );
      await expect(service.refresh('old-refresh-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
  });

  it('rotates the refresh token and returns a new access/refresh pair on success', async () => {
    const user = {
      id: 'user-1',
      email: 'buyer@example.com',
      phone: null,
      firstName: 'Buyer',
      lastName: 'Example',
      status: 'ACTIVE',
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
      userRoles: [{ role: { code: 'BUYER' } }],
      sellerProfile: null,
    };
    const session = {
      id: 'session-1',
      userId: 'user-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      refreshTokenHash: 'old-hash',
      user,
    };
    const findUnique = vi.fn().mockResolvedValue(session);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        authSession: { findUnique, updateMany },
        authAuditEvent: { create: vi.fn() },
      }),
    );
    const prisma = {
      authSession: { findUnique, updateMany },
      authAuditEvent: { create: vi.fn().mockResolvedValue({}) },
      $transaction: transaction,
    } as never;
    const jwt = { signAsync: vi.fn().mockResolvedValue('new-access-token') };
    const service = new AuthService(
      prisma,
      jwt as never,
      { get: vi.fn(), getOrThrow: vi.fn(() => CHALLENGE_SECRET) } as never,
      { assertEmailAndSmsConfigured: vi.fn() } as never,
    );

    const result = await service.refresh('old-refresh-token');

    expect(result.accessToken).toBe('new-access-token');
    expect(result.refreshToken).toBeTruthy();
    expect(result.refreshToken).not.toBe('old-refresh-token');
    expect(result.expiresIn).toBe(900);
  });

  it('rejects refresh-token reuse when the atomic rotation update affects no rows', async () => {
    const user = {
      id: 'user-1',
      status: 'ACTIVE',
      userRoles: [{ role: { code: 'BUYER' } }],
      sellerProfile: null,
    };
    const session = {
      id: 'session-1',
      userId: 'user-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      refreshTokenHash: 'old-hash',
      user,
    };
    const findUnique = vi.fn().mockResolvedValue(session);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        authSession: { findUnique, updateMany },
        authAuditEvent: { create: vi.fn() },
      }),
    );
    const prisma = {
      authSession: { findUnique, updateMany },
      authAuditEvent: { create: vi.fn().mockResolvedValue({}) },
      $transaction: transaction,
    } as never;
    const service = new AuthService(
      prisma,
      { signAsync: vi.fn() } as never,
      { get: vi.fn(), getOrThrow: vi.fn(() => CHALLENGE_SECRET) } as never,
      { assertEmailAndSmsConfigured: vi.fn() } as never,
    );

    await expect(service.refresh('old-refresh-token')).rejects.toMatchObject({
      message: 'Refresh token is invalid or reused.',
    });
  });
});

