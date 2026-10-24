import { randomBytes } from 'node:crypto';
import {
  assertProductionDatabaseIdentity,
  assertProductionDatabaseTarget,
  assertDevelopmentDatabaseIdentity,
  assertDevelopmentDatabaseTarget,
} from './admin-provisioning.js';
import { validateAdminInput } from './admin-input.js';

describe('development admin provisioning safety', () => {
  const safeEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://hulegeb_user:local@127.0.0.1:5433/hulegeb_dev',
  };

  it('accepts only the explicitly configured local development target', () => {
    expect(assertDevelopmentDatabaseTarget(safeEnvironment).hostname).toBe(
      '127.0.0.1',
    );

    for (const environment of [
      { ...safeEnvironment, NODE_ENV: 'production' },
      { ...safeEnvironment, DATABASE_URL: undefined },
      {
        ...safeEnvironment,
        DATABASE_URL: 'postgresql://localhost:5433/hulegeb_dev',
      },
      {
        ...safeEnvironment,
        DATABASE_URL: 'postgresql://127.0.0.1:5433/production',
      },
      {
        ...safeEnvironment,
        DATABASE_URL: 'postgresql://127.0.0.1:5432/hulegeb_dev',
      },
      {
        ...safeEnvironment,
        DATABASE_URL: 'mysql://127.0.0.1:5433/hulegeb_dev',
      },
      {
        ...safeEnvironment,
        DATABASE_URL:
          'postgresql://127.0.0.1:5433/hulegeb_dev?host=production-db.example',
      },
    ]) {
      expect(() => assertDevelopmentDatabaseTarget(environment)).toThrow();
    }
  });

  it('checks the connected database name and PostgreSQL port', () => {
    expect(() =>
      assertDevelopmentDatabaseIdentity([
        { databaseName: 'hulegeb_dev', serverPort: 5432 },
      ]),
    ).not.toThrow();

    for (const identity of [
      [{ databaseName: 'hulegeb_auth_test', serverPort: 5432 }],
      [{ databaseName: 'hulegeb_dev', serverPort: 5433 }],
      [],
    ]) {
      expect(() => assertDevelopmentDatabaseIdentity(identity)).toThrow();
    }
  });
});

describe('production admin provisioning safety', () => {
  const safeEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    DATABASE_URL:
      'postgresql://admin:secret@postgres.prod.internal:5432/hulegeb',
  };

  it('accepts only a remote production PostgreSQL target', () => {
    expect(
      assertProductionDatabaseTarget(safeEnvironment).hostname,
    ).toBe('postgres.prod.internal');

    for (const environment of [
      { ...safeEnvironment, NODE_ENV: 'development' },
      { ...safeEnvironment, DATABASE_URL: undefined },
      {
        ...safeEnvironment,
        DATABASE_URL: 'postgresql://admin:secret@localhost:5432/hulegeb',
      },
      {
        ...safeEnvironment,
        DATABASE_URL:
          'postgresql://admin:secret@postgres:5432/hulegeb',
      },
      {
        ...safeEnvironment,
        DATABASE_URL:
          'postgresql://admin:secret@127.0.0.1:5433/hulegeb_dev',
      },
      {
        ...safeEnvironment,
        DATABASE_URL:
          'postgresql://admin:secret@postgres.prod.internal:5432/hulegeb_auth_test',
      },
      {
        ...safeEnvironment,
        DATABASE_URL:
          'postgresql://admin:secret@postgres.prod.internal:5432/hulegeb_staging',
      },
      {
        ...safeEnvironment,
        DATABASE_URL: 'mysql://admin:secret@postgres.prod.internal:5432/hulegeb',
      },
      {
        ...safeEnvironment,
        DATABASE_URL:
          'postgresql://admin:secret@postgres.prod.internal:5432/hulegeb?host=localhost',
      },
    ]) {
      expect(() => assertProductionDatabaseTarget(environment)).toThrow();
    }
  });

  it('checks the connected production database name and port', () => {
    const target = assertProductionDatabaseTarget(safeEnvironment);
    expect(() =>
      assertProductionDatabaseIdentity(
        [{ databaseName: 'hulegeb', serverPort: 5432 }],
        target,
      ),
    ).not.toThrow();

    for (const identity of [
      [{ databaseName: 'hulegeb_auth_test', serverPort: 5432 }],
      [{ databaseName: 'hulegeb', serverPort: 5433 }],
      [],
    ]) {
      expect(() =>
        assertProductionDatabaseIdentity(identity, target),
      ).toThrow();
    }
  });
});

describe('development admin input validation', () => {
  const validInput = {
    firstName: 'Dev',
    lastName: 'Admin',
    email: '  Dev.Admin@example.test ',
    phone: '+251911234567',
    password: randomBytes(16).toString('base64url'),
  };

  it('normalizes email and phone and preserves the supplied password', () => {
    expect(validateAdminInput(validInput)).toEqual({
      ...validInput,
      email: 'dev.admin@example.test',
      phone: '+251911234567',
    });
  });

  it.each([
    [{ ...validInput, firstName: '  ' }],
    [{ ...validInput, lastName: 'x'.repeat(81) }],
    [{ ...validInput, email: 'not-an-email' }],
    [{ ...validInput, phone: 'not-a-phone' }],
    [{ ...validInput, password: 'short' }],
    [{ ...validInput, password: 'é'.repeat(37) }],
  ])('rejects missing or invalid required input', (input) => {
    expect(() => validateAdminInput(input)).toThrow();
  });
});
