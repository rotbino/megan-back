import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * @CurrentUser() → { userId, phone } از روی توکن تاییدشده توسط JwtAuthGuard
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest();
    return { userId: request.userId as string, phone: request.phone as string };
  },
);
