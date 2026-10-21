import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  PUBLIC_KEY,
  RequestUser,
} from '../authorization/authorization.constants.js';
import { AuthService } from './auth.service.js';

interface AccessTokenPayload {
  sub?: unknown;
  sid?: unknown;
}

interface AuthenticatedRequest {
  headers: { authorization?: string };
  user?: RequestUser;
}

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const [scheme, token, ...extra] = authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token || extra.length > 0) {
      throw new UnauthorizedException('A valid bearer token is required.');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired.');
    }

    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw new UnauthorizedException('Access token is invalid.');
    }

    const user = await this.authService.loadAuthenticatedUser(
      payload.sub,
      payload.sid,
    );
    if (!user) {
      throw new UnauthorizedException('Session is invalid or expired.');
    }

    request.user = user;
    return true;
  }
}
