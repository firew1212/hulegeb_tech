import type { ObserveOptions } from '@nestjs/observe';

const PLACEHOLDER_VALUE =
  /^(?:replace[-_ ]|your[-_ ]|paste[-_ ]|change[-_ ]|placeholder|todo|changeme|example(?:\.|$))/i;
const DATABASE_TARGET_OVERRIDES = new Set([
  'host',
  'hostaddr',
  'port',
  'dbname',
  'database',
]);

function requiredValue(
  config: Record<string, unknown>,
  key: string,
): string {
  const value = config[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required in production.`);
  }
  if (PLACEHOLDER_VALUE.test(value.trim())) {
    throw new Error(`${key} must not use a placeholder value.`);
  }
  return value.trim();
}

function validateSecretStrength(value: string, key: string): void {
  if (value.length < 32 || new Set(value).size < 12) {
    throw new Error(
      `${key} must be at least 32 characters and contain sufficient variation.`,
    );
  }
}

function parseUrl(value: string, key: string): URL {
  try {
    const url = new URL(value);
    if (
      /(?:^|\.)(?:example|invalid|test|localhost)$/i.test(url.hostname) ||
      /(?:your|placeholder|example)/i.test(url.hostname)
    ) {
      throw new Error();
    }
    return url;
  } catch {
    throw new Error(`${key} must be a valid, non-placeholder URL.`);
  }
}

function validateProductionEnvironment(
  config: Record<string, unknown>,
): void {
  const databaseUrl = parseUrl(requiredValue(config, 'DATABASE_URL'), 'DATABASE_URL');
  const databaseName = decodeURIComponent(
    databaseUrl.pathname.replace(/^\/+/, ''),
  );
  const hostname = databaseUrl.hostname.toLowerCase().replace(/\.$/, '');
  const localHost =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'postgres' ||
    hostname === 'hulegeb-postgres' ||
    hostname === 'host.docker.internal' ||
    hostname === 'gateway.docker.internal' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('127.');
  const targetOverride = [...databaseUrl.searchParams.keys()].some((key) =>
    DATABASE_TARGET_OVERRIDES.has(key.toLowerCase()),
  );

  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    localHost ||
    targetOverride ||
    !databaseName ||
    /(^|[_-])(dev|development|test|testing|staging|qa)([_-]|$)/i.test(
      databaseName,
    )
  ) {
    throw new Error(
      'DATABASE_URL must target a non-local production PostgreSQL database, not a development, test, staging, or QA database.',
    );
  }

  const accessSecret = requiredValue(config, 'JWT_ACCESS_SECRET');
  const challengeSecret = requiredValue(config, 'AUTH_CHALLENGE_SECRET');
  validateSecretStrength(accessSecret, 'JWT_ACCESS_SECRET');
  validateSecretStrength(challengeSecret, 'AUTH_CHALLENGE_SECRET');
  if (accessSecret === challengeSecret) {
    throw new Error(
      'JWT_ACCESS_SECRET and AUTH_CHALLENGE_SECRET must be different values.',
    );
  }

  if (config.AUTH_EMAIL_MODE !== 'brevo') {
    throw new Error('AUTH_EMAIL_MODE must be explicitly set to brevo in production.');
  }
  const brevoApiKey = requiredValue(config, 'BREVO_API_KEY');
  if (brevoApiKey.length < 16) {
    throw new Error('BREVO_API_KEY must be a configured provider credential.');
  }
  const sender = requiredValue(config, 'AUTH_EMAIL_FROM');
  const senderEmail = sender.match(/^\s*.*?<([^<>]+)>\s*$/)?.[1] ?? sender;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    throw new Error('AUTH_EMAIL_FROM must contain a valid sender email address.');
  }
  if (
    /(?:^|@)(?:example\.(?:com|net|org)|[^@\s]+\.example|[^@\s]+\.test)(?:$|>)/i.test(
      sender,
    )
  ) {
    throw new Error('AUTH_EMAIL_FROM must not use a placeholder email domain.');
  }

  const frontendUrl = parseUrl(
    requiredValue(config, 'FRONTEND_URL'),
    'FRONTEND_URL',
  );
  if (frontendUrl.protocol !== 'https:' || frontendUrl.username || frontendUrl.password) {
    throw new Error('FRONTEND_URL must use HTTPS and must not include credentials.');
  }

  if (config.AUTH_SMS_MODE !== 'webhook') {
    throw new Error('AUTH_SMS_MODE must be explicitly set to webhook in production.');
  }
  const smsUrl = parseUrl(
    requiredValue(config, 'AUTH_SMS_WEBHOOK_URL'),
    'AUTH_SMS_WEBHOOK_URL',
  );
  if (
    smsUrl.protocol !== 'https:' ||
    smsUrl.username ||
    smsUrl.password
  ) {
    throw new Error(
      'AUTH_SMS_WEBHOOK_URL must use HTTPS and must not include credentials.',
    );
  }
  const deliveryToken = requiredValue(
    config,
    'AUTH_DELIVERY_WEBHOOK_TOKEN',
  );
  validateSecretStrength(deliveryToken, 'AUTH_DELIVERY_WEBHOOK_TOKEN');

  const phone = requiredValue(config, 'HULEGEB_OFFICIAL_PHONE');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new Error('HULEGEB_OFFICIAL_PHONE must use E.164 format.');
  }
  const telegram = requiredValue(config, 'HULEGEB_OFFICIAL_TELEGRAM');
  if (
    !/^(?:@[A-Za-z0-9_]{5,32}|https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\/?)$/.test(
      telegram,
    )
  ) {
    throw new Error(
      'HULEGEB_OFFICIAL_TELEGRAM must be an @username or an HTTPS t.me URL.',
    );
  }

  const corsOriginsRaw =
    config.CORS_ALLOWED_ORIGINS ??
    config.CORS_ORIGINS ??
    config.ALLOWED_ORIGINS;
  if (corsOriginsRaw !== undefined && String(corsOriginsRaw).trim() !== '') {
    for (const origin of String(corsOriginsRaw).split(',').map((value) => value.trim()).filter(Boolean)) {
      const corsUrl = parseUrl(origin, 'CORS_ALLOWED_ORIGINS');
      if (corsUrl.protocol !== 'https:' || corsUrl.username || corsUrl.password) {
        throw new Error('CORS_ALLOWED_ORIGINS must use HTTPS and must not include credentials.');
      }
    }
  }

  if (config.PORT !== undefined) {
    const port = Number(config.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('PORT must be an integer from 1 to 65535.');
    }
  }
}

export function getObserveOptions(
  environment: NodeJS.ProcessEnv = process.env,
): ObserveOptions | undefined {
  const appKey = environment.OBSERVE_APP_KEY?.trim();
  const appSecret = environment.OBSERVE_APP_SECRET?.trim();
  const serviceId = environment.OBSERVE_SERVICE_ID?.trim();

  if (!appKey && !appSecret && !serviceId) {
    return undefined;
  }
  if (!appKey || !appSecret || !serviceId) {
    throw new Error(
      'OBSERVE_APP_KEY, OBSERVE_APP_SECRET, and OBSERVE_SERVICE_ID must be configured together.',
    );
  }
  if ([appKey, appSecret, serviceId].some((value) => PLACEHOLDER_VALUE.test(value))) {
    throw new Error('Observability settings must not use placeholder values.');
  }

  return { appKey, appSecret, serviceId };
}

export function hasObserveOptions(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    environment.OBSERVE_APP_KEY?.trim() &&
      environment.OBSERVE_APP_SECRET?.trim() &&
      environment.OBSERVE_SERVICE_ID?.trim(),
  );
}

function parseCorsOrigins(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split(',').map((o) => o.trim()).filter((o) => o.length > 0);
}

export function getAllowedCorsOrigins(environment: NodeJS.ProcessEnv = process.env) {
  const configured = parseCorsOrigins(
    environment && (environment.CORS_ALLOWED_ORIGINS || environment.CORS_ORIGINS || environment.ALLOWED_ORIGINS)
  );
  if (configured.length > 0) return configured;
  const frontendUrl = environment && environment.FRONTEND_URL ? environment.FRONTEND_URL.trim() : '';
  return frontendUrl ? [frontendUrl] : [];
}

export const getCorsAllowedOrigins = getAllowedCorsOrigins;
export const getCorsOrigins = getAllowedCorsOrigins;
export const getAllowedOrigins = getAllowedCorsOrigins;

export function isAllowedCorsOrigin(origin: string | undefined, environment: NodeJS.ProcessEnv = process.env) {
  if (!origin) return false;
  const normalizedOrigin = origin.trim().replace(/\/$/, '');
  return getAllowedCorsOrigins(environment).some((allowed) => allowed.trim().replace(/\/$/, '') === normalizedOrigin);
}

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (
    config.NODE_ENV !== 'development' &&
    config.NODE_ENV !== 'test' &&
    config.NODE_ENV !== 'production'
  ) {
    throw new Error(
      'NODE_ENV must be explicitly set to development, test, or production.',
    );
  }

  getObserveOptions({
    OBSERVE_APP_KEY:
      typeof config.OBSERVE_APP_KEY === 'string'
        ? config.OBSERVE_APP_KEY
        : undefined,
    OBSERVE_APP_SECRET:
      typeof config.OBSERVE_APP_SECRET === 'string'
        ? config.OBSERVE_APP_SECRET
        : undefined,
    OBSERVE_SERVICE_ID:
      typeof config.OBSERVE_SERVICE_ID === 'string'
        ? config.OBSERVE_SERVICE_ID
        : undefined,
  });

  if (config.NODE_ENV === 'production') {
    validateProductionEnvironment(config);
  }

  return config;
}
export function isSwaggerEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = environment.SWAGGER_ENABLED?.trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return environment.NODE_ENV !== 'production';
}

