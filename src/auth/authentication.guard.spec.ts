import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { RequestUser } from '../authorization/authorization.constants.js';
import { Public } from '../authorization/roles.decorator.js';
import { AuthService } from './auth.service.js';
import { AuthenticationGuard } from './authentication.guard.js';

function makeContext(
  handler: () => void,
  authorization?: string,
): ExecutionContext {
  const request: { headers: { authorization?: string }; user?: RequestUser } = {
    headers: { authorization },
  };
  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AuthenticationGuard', () => {
  it('allows an explicitly public route without a bearer token', async () => {
    const handler = () => undefined;
    Public()(handler);
    const guard = new AuthenticationGuard(
      new Reflector(),
      {} as JwtService,
      {} as AuthService,
    );

    await expect(guard.canActivate(makeContext(handler))).resolves.toBe(true);
  });

  it('rejects protected requests without a bearer token', async () => {
    const guard = new AuthenticationGuard(
      new Reflector(),
      {} as JwtService,
      {} as AuthService,
    );

    await expect(
      guard.canActivate(makeContext(() => undefined)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose persisted session is revoked', async () => {
    const authService = {
      loadAuthenticatedUser: vi.fn().mockResolvedValue(undefined),
    };
    const jwt = {
      verifyAsync: vi
        .fn()
        .mockResolvedValue({ sub: 'user-1', sid: 'session-1' }),
    };
    const guard = new AuthenticationGuard(
      new Reflector(),
      jwt as unknown as JwtService,
      authService as unknown as AuthService,
    );

    await expect(
      guard.canActivate(makeContext(() => undefined, 'Bearer signed-token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.loadAuthenticatedUser).toHaveBeenCalledWith(
      'user-1',
      'session-1',
    );
  });
});
