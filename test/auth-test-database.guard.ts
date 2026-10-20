import { randomBytes } from 'node:crypto';

function getDatabaseName(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Authentication e2e tests require a valid PostgreSQL URL.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('Authentication e2e tests require a PostgreSQL URL.');
  }

  return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
}

export function configureAuthTestDatabase(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const testDatabaseUrl = environment.AUTH_TEST_DATABASE_URL;
  if (
    !testDatabaseUrl ||
    getDatabaseName(testDatabaseUrl) !== 'hulegeb_auth_test'
  ) {
    throw new Error(
      'Refusing e2e setup: AUTH_TEST_DATABASE_URL must explicitly target hulegeb_auth_test.',
    );
  }

  environment.DATABASE_URL = testDatabaseUrl;
  if (getDatabaseName(environment.DATABASE_URL) !== 'hulegeb_auth_test') {
    throw new Error(
      'Refusing e2e setup: DATABASE_URL is not the auth test database.',
    );
  }

  environment.NODE_ENV = 'test';
  environment.JWT_ACCESS_SECRET = randomBytes(32).toString('base64url');
  environment.AUTH_CHALLENGE_SECRET = randomBytes(32).toString('base64url');
  environment.AUTH_EMAIL_MODE = 'console';
  environment.AUTH_SMS_MODE = 'console';
}
