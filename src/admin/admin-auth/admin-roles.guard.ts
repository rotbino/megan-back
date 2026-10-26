import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/** کلید متادیتای نقش‌های مجاز — با @SetMetadata('adminRoles', [...]) ست می‌شود */
export const ADMIN_ROLES_KEY = 'adminRoles';

/**
 * گارد نقش ادمین — بعد از AdminJwtAuthGuard روی همان route.
 * request.adminRole توسط گارد توکن گذاشته شده است (SUPER_ADMIN | ADMIN).
 *
 * استفاده:
 *   @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
 *   @SetMetadata('adminRoles', ['SUPER_ADMIN'])
 */
@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // بدون متادیتا → همه ادمین‌های احرازشده مجازند
    if (!roles || roles.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ adminRole?: string }>();
    if (roles.includes(request.adminRole ?? '')) return true;

    throw new ForbiddenException({
      code: 'ADMIN_ROLE_REQUIRED',
      message: 'این عملیات فقط برای مدیر ارشد (SUPER_ADMIN) مجاز است.',
    });
  }
}
