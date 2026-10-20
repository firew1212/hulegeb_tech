import { configureAuthTestDatabase } from './auth-test-database.guard.js';

describe('authentication test database safety guard', () => {
  it('refuses to run without an explicitly supplied test database URL', () => {
    const environment: NodeJS.ProcessEnv = {
      DATABASE_URL: 'postgresql://localhost/hulegeb_dev',
    };

    expect(() => configureAuthTestDatabase(environment)).toThrow(
      'Refusing e2e setup: AUTH_TEST_DATABASE_URL must explicitly target hulegeb_auth_test.',
    );
    expect(environment.DATABASE_URL).toBe(
      'postgresql://localhost/hulegeb_dev',
    );
  });

  it('refuses an explicitly supplied development database URL', () => {
    const environment: NodeJS.ProcessEnv = {
      DATABASE_URL: 'postgresql://localhost/hulegeb_dev',
      AUTH_TEST_DATABASE_URL: 'postgresql://localhost/hulegeb_dev',
    };

    expect(() => configureAuthTestDatabase(environment)).toThrow(
      'Refusing e2e setup: AUTH_TEST_DATABASE_URL must explicitly target hulegeb_auth_test.',
    );
    expect(environment.DATABASE_URL).toBe(
      'postgresql://localhost/hulegeb_dev',
    );
  });

  it('sets the process database URL only to hulegeb_auth_test', () => {
    const environment: NodeJS.ProcessEnv = {
      DATABASE_URL: 'postgresql://localhost/hulegeb_dev',
      AUTH_TEST_DATABASE_URL: 'postgresql://localhost/hulegeb_auth_test',
    };

    configureAuthTestDatabase(environment);

    expect(environment.DATABASE_URL).toBe(
      'postgresql://localhost/hulegeb_auth_test',
    );
    expect(environment.NODE_ENV).toBe('test');
    expect(environment.JWT_ACCESS_SECRET).toHaveLength(43);
    expect(environment.AUTH_CHALLENGE_SECRET).toHaveLength(43);
    expect(environment.AUTH_EMAIL_MODE).toBe('console');
    expect(environment.AUTH_SMS_MODE).toBe('console');
  });
});
