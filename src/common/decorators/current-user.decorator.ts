import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequestWithUser } from '../guards';

/** کاربر جاری از توکن — @CurrentUser() user: AuthUser */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<FastifyRequestWithUser>();
  return { id: request.userId!, phone: request.phone!, role: request.role ?? 'USER' };
});
