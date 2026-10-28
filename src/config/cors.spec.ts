import { randomBytes } from 'node:crypto';
import {
  getAllowedCorsOrigins,
  getCorsOrigins,
  isAllowedCorsOrigin,
  validateEnvironment,
} from './environment.js';

describe('CORS origin configuration', () => {
  it('falls back to FRONTEND_URL when no explicit origins are configured', () => {
    expect(
      getAllowedCorsOrigins({ FRONTEND_URL: 'http://localhost:3001' } as NodeJS.ProcessEnv),
    ).toEqual(['http://localhost:3001']);
  });

  it('parses comma-separated explicit origins', () => {
    const environment = {
      CORS_ALLOWED_ORIGINS: 'https://a.example, https://b.example',
      FRONTEND_URL: 'https://ignored.example',
    } as unknown as NodeJS.ProcessEnv;
    expect(getAllowedCorsOrigins(environment)).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(getCorsOrigins(environment)).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('supports origin aliases', () => {
    const environment = {
      CORS_ORIGINS: 'https://alias.example',
    } as unknown as NodeJS.ProcessEnv;
    expect(getAllowedCorsOrigins(environment)).toEqual(['https://alias.example']);
  });

  it('matches allowed origins with or without a trailing slash', () => {
    const environment = {
      CORS_ALLOWED_ORIGINS: 'https://app.example/',
    } as unknown as NodeJS.ProcessEnv;
    expect(isAllowedCorsOrigin('https://app.example', environment)).toBe(true);
    expect(isAllowedCorsOrigin('https://app.example/', environment)).toBe(true);
    expect(isAllowedCorsOrigin('https://evil.example', environment)).toBe(false);
    expect(isAllowedCorsOrigin(undefined, environment)).toBe(false);
  });

  it('does not allow every origin by default', () => {
    expect(getAllowedCorsOrigins({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe('production CORS validation', () => {
  const baseProductionEnvironment = {
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

  it('accepts explicit HTTPS origins', () => {
    expect(() =>
      validateEnvironment({
        ...baseProductionEnvironment,
        CORS_ALLOWED_ORIGINS: 'https://app.hulegeb.com,https://admin.hulegeb.com',
      }),
    ).not.toThrow();
  });

  it('rejects wildcard or insecure origins', () => {
    for (const value of ['*', 'http://app.hulegeb.com', 'https://example.com']) {
      expect(() =>
        validateEnvironment({
          ...baseProductionEnvironment,
          CORS_ALLOWED_ORIGINS: value,
        }),
      ).toThrow();
    }
  });
});
