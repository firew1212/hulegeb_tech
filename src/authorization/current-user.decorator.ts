import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestUser } from './authorization.constants.js';

export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{
      user?: RequestUser;
    }>();

    const user = request.user;

    if (!user) {
      return undefined;
    }

    return data ? user[data] : user;
  },
);
