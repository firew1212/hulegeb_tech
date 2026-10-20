import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AppRole,
  PUBLIC_KEY,
  REQUIRE_SELLER_APPROVAL_KEY,
  RequestUser,
  ROLES_KEY,
} from './authorization.constants.js';
import { AuthorizationService } from './authorization.service.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: RequestUser;
    }>();

    const user = request.user;

    const requiredRoles =
      this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const requireSellerApproval =
      this.reflector.getAllAndOverride<boolean>(
        REQUIRE_SELLER_APPROVAL_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? false;

    // AuthenticationGuard should populate request.user first.
    if (!user) {
      throw new UnauthorizedException('Authentication is required.');
    }

    if (!this.authorizationService.isAccountActive(user)) {
      throw new ForbiddenException('Your account is not active.');
    }

    if (
      !this.authorizationService.canAccess(
        user,
        requiredRoles,
        requireSellerApproval,
      )
    ) {
      if (
        requireSellerApproval ||
        requiredRoles.includes('SELLER')
      ) {
        throw new ForbiddenException(
          'An approved seller account is required.',
        );
      }

      throw new ForbiddenException(
        'You do not have permission to access this resource.',
      );
    }

    return true;
  }
}