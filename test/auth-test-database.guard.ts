import { randomBytes } from 'node:crypto';

const AUTH_TEST_DATABASE_NAME = 'hulegeb_auth_test';
const AUTH_TEST_DATABASE_HOST = '127.0.0.1';
const AUTH_TEST_DATABASE_PORT = '5433';

function parseAuthTestDatabaseUrl(connectionString: string | undefined): URL {
  if (!connectionString || connectionString !== connectionString.trim()) {
    throw new Error(
      'Refusing e2e setup: AUTH_TEST_DATABASE_URL must target the dedicated local PostgreSQL test database.',
    );
  }

  if (connectionString.includes('?') || connectionString.includes('#')) {
    throw new Error(
      'Refusing e2e setup: AUTH_TEST_DATABASE_URL must not include query parameters or fragments.',
    );
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(
      'Refusing e2e setup: AUTH_TEST_DATABASE_URL must be a valid PostgreSQL URL.',
    );
  }

  let username: string;
  let password: string;
  let databaseName: string;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    throw new Error(
      'Refusing e2e setup: AUTH_TEST_DATABASE_URL contains invalid percent-encoding.',
    );
  }

  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    url.hostname !== AUTH_TEST_DATABASE_HOST ||
    url.port !== AUTH_TEST_DATABASE_PORT ||
    url.pathname !== `/${AUTH_TEST_DATABASE_NAME}` ||
    databaseName !== AUTH_TEST_DATABASE_NAME ||
    username.length === 0 ||
    password.length === 0
  ) {
    throw new Error(
      'Refusing e2e setup: AUTH_TEST_DATABASE_URL must target 127.0.0.1:5433/hulegeb_auth_test.',
    );
  }

  return url;
}

export function configureAuthTestDatabase(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const testDatabaseUrl = parseAuthTestDatabaseUrl(
    environment.AUTH_TEST_DATABASE_URL,
  );

  environment.DATABASE_URL = testDatabaseUrl.toString();
  environment.NODE_ENV = 'test';
  environment.JWT_ACCESS_SECRET = randomBytes(32).toString('base64url');
  environment.AUTH_CHALLENGE_SECRET = randomBytes(32).toString('base64url');
  environment.AUTH_EMAIL_MODE = 'console';
  environment.AUTH_SMS_MODE = 'console';
}
