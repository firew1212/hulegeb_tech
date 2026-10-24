import { configureAuthTestDatabase } from './auth-test-database.guard.js';

describe('authentication test database safety guard', () => {
  const validTestDatabaseUrl =
    'postgresql://test-user:test-password@127.0.0.1:5433/hulegeb_auth_test';

  it('refuses to run without an explicitly supplied test database URL', () => {
    const environment: NodeJS.ProcessEnv = {
      DATABASE_URL: 'postgresql://localhost/hulegeb_dev',
    };

    expect(() => configureAuthTestDatabase(environment)).toThrow();
    expect(environment.DATABASE_URL).toBe('postgresql://localhost/hulegeb_dev');
  });

  it.each([
    ['malformed URL', 'postgresql://%'],
    [
      'malformed credential percent-encoding',
      'postgresql://test%ZZ-user:test-password@127.0.0.1:5433/hulegeb_auth_test',
    ],
    [
      'malformed database percent-encoding',
      'postgresql://test-user:test-password@127.0.0.1:5433/hulegeb_auth_test%ZZ',
    ],
    [
      'wrong host',
      'postgresql://test-user:test-password@example.com:5433/hulegeb_auth_test',
    ],
    [
      'query parameter host override',
      'postgresql://test-user:test-password@127.0.0.1:5433/hulegeb_auth_test?host=prod.example.com',
    ],
    [
      'query parameter port override',
      'postgresql://test-user:test-password@127.0.0.1:5433/hulegeb_auth_test?port=5432',
    ],
    [
      'query parameter host and port override',
      'postgresql://test-user:test-password@127.0.0.1:5433/hulegeb_auth_test?host=prod.example.com&port=5432',
    ],
    [
      'localhost alias',
      'postgresql://test-user:test-password@localhost:5433/hulegeb_auth_test',
    ],
    [
      'wrong port',
      'postgresql://test-user:test-password@127.0.0.1:5432/hulegeb_auth_test',
    ],
    [
      'missing port',
      'postgresql://test-user:test-password@127.0.0.1/hulegeb_auth_test',
    ],
    [
      'wrong database',
      'postgresql://test-user:test-password@127.0.0.1:5433/hulegeb_dev',
    ],
    [
      'production database name',
      'postgresql://test-user:test-password@127.0.0.1:5433/production',
    ],
    [
      'production host and database',
      'postgresql://test-user:test-password@prod.example.com:5432/production',
    ],
    [
      'development host and database',
      'postgresql://test-user:test-password@dev.example.com:5433/hulegeb_dev',
    ],
    [
      'wrong protocol',
      'mysql://test-user:test-password@127.0.0.1:5433/hulegeb_auth_test',
    ],
    ['missing hostname', 'postgresql:///hulegeb_auth_test'],
    [
      'missing username',
      'postgresql://:test-password@127.0.0.1:5433/hulegeb_auth_test',
    ],
    [
      'missing password',
      'postgresql://test-user@127.0.0.1:5433/hulegeb_auth_test',
    ],
  ])('rejects a %s URL', (_description, url) => {
    const environment: NodeJS.ProcessEnv = {
      DATABASE_URL: 'postgresql://localhost/hulegeb_dev',
      AUTH_TEST_DATABASE_URL: url,
    };

    expect(() => configureAuthTestDatabase(environment)).toThrow();
    expect(environment.DATABASE_URL).toBe('postgresql://localhost/hulegeb_dev');
  });

  it('accepts only the explicitly allowlisted local test server and database', () => {
    const environment: NodeJS.ProcessEnv = {
      DATABASE_URL: 'postgresql://localhost/hulegeb_dev',
      AUTH_TEST_DATABASE_URL: validTestDatabaseUrl,
    };

    configureAuthTestDatabase(environment);

    expect(environment.DATABASE_URL).toBe(validTestDatabaseUrl);
    expect(environment.NODE_ENV).toBe('test');
    expect(environment.JWT_ACCESS_SECRET).toHaveLength(43);
    expect(environment.AUTH_CHALLENGE_SECRET).toHaveLength(43);
    expect(environment.AUTH_EMAIL_MODE).toBe('console');
    expect(environment.AUTH_SMS_MODE).toBe('console');
  });
});
