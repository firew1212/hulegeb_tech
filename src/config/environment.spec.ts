import { randomBytes } from 'node:crypto';
import {
  getObserveOptions,
  validateEnvironment,
} from './environment.js';

const productionEnvironment: Record<string, unknown> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:secret@db.prod.internal:5432/hulegeb',
  JWT_ACCESS_SECRET: randomBytes(32).toString('base64url'),
  AUTH_CHALLENGE_SECRET: randomBytes(32).toString('base64url'),
  AUTH_EMAIL_MODE: 'brevo',
  BREVO_API_KEY: 'provider-api-key',
  AUTH_EMAIL_FROM: 'Hulegeb <no-reply@hulegeb.com>',
  FRONTEND_URL: 'https://shop.hulegeb.com',
  AUTH_SMS_MODE: 'webhook',
  AUTH_SMS_WEBHOOK_URL: 'https://sms.hulegeb.com/send',
  AUTH_DELIVERY_WEBHOOK_TOKEN: randomBytes(32).toString('base64url'),
  HULEGEB_OFFICIAL_PHONE: '+251911234567',
  HULEGEB_OFFICIAL_TELEGRAM: '@hulegeb',
};

describe('production environment validation', () => {
  it('accepts complete production settings and preserves them', () => {
    expect(validateEnvironment(productionEnvironment)).toBe(
      productionEnvironment,
    );
  });

  it.each([
    ['DATABASE_URL', undefined],
    ['DATABASE_URL', 'postgresql://app:secret@localhost:5432/hulegeb'],
    ['DATABASE_URL', 'postgresql://app:secret@postgres:5432/hulegeb'],
    ['DATABASE_URL', 'postgresql://app:secret@db:5432/hulegeb_auth_test'],
    [
      'DATABASE_URL',
      'postgresql://app:secret@db.prod.internal:5432/hulegeb?host=localhost',
    ],
    ['JWT_ACCESS_SECRET', 'replace-with-a-real-secret-value'],
    ['JWT_ACCESS_SECRET', 'a'.repeat(32)],
    ['AUTH_CHALLENGE_SECRET', 'short'],
    ['AUTH_EMAIL_MODE', undefined],
    ['AUTH_EMAIL_MODE', 'console'],
    ['BREVO_API_KEY', 'YOUR_API_KEY'],
    ['AUTH_EMAIL_FROM', 'no-reply@example.com'],
    ['FRONTEND_URL', 'http://shop.hulegeb.com'],
    ['FRONTEND_URL', 'https://your-frontend.example'],
    ['AUTH_SMS_MODE', 'console'],
    ['AUTH_SMS_WEBHOOK_URL', 'http://sms.hulegeb.com/send'],
    ['AUTH_SMS_WEBHOOK_URL', 'https://sms.example/send'],
    ['AUTH_DELIVERY_WEBHOOK_TOKEN', 'short'],
    ['AUTH_DELIVERY_WEBHOOK_TOKEN', 'b'.repeat(32)],
    ['HULEGEB_OFFICIAL_PHONE', 'REPLACE_WITH_PHONE'],
    ['HULEGEB_OFFICIAL_TELEGRAM', 'REPLACE_WITH_USERNAME'],
    ['PORT', '70000'],
  ])('rejects unsafe or missing %s', (key, value) => {
    const config = { ...productionEnvironment, [key]: value };
    expect(() => validateEnvironment(config)).toThrow();
  });

  it('requires independent application secrets', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        AUTH_CHALLENGE_SECRET: productionEnvironment.JWT_ACCESS_SECRET,
      }),
    ).toThrow(/must be different/);
  });

  it('does not apply production-only requirements to development or tests', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(() => validateEnvironment({ NODE_ENV })).not.toThrow();
    }
  });

  it.each([undefined, '', 'staging'])(
    'rejects missing or unsupported NODE_ENV: %s',
    (NODE_ENV) => {
      expect(() => validateEnvironment({ NODE_ENV })).toThrow(
        /NODE_ENV must be explicitly set/,
      );
    },
  );
});

describe('optional observability configuration', () => {
  it('disables Observe when no credentials are provided', () => {
    expect(getObserveOptions({})).toBeUndefined();
  });

  it('uses explicit credentials when all settings are provided', () => {
    expect(
      getObserveOptions({
        OBSERVE_APP_KEY: 'configured-key',
        OBSERVE_APP_SECRET: 'configured-secret',
        OBSERVE_SERVICE_ID: 'back-end',
      }),
    ).toEqual({
      appKey: 'configured-key',
      appSecret: 'configured-secret',
      serviceId: 'back-end',
    });
  });

  it.each([
    { OBSERVE_APP_KEY: 'configured-key' },
    {
      OBSERVE_APP_KEY: 'YOUR_APP_KEY',
      OBSERVE_APP_SECRET: 'configured-secret',
      OBSERVE_SERVICE_ID: 'back-end',
    },
  ])('rejects partial or placeholder settings', (environment) => {
    expect(() => getObserveOptions(environment)).toThrow();
  });
});
