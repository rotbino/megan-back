import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { SecurityService } from './security.service';

/**
 * گارد سراسری بلاک‌لیست IP — روی هر درخواست اجرا می‌شود و IPهای
 * بلاک‌شدهٔ سرویس امنیت (مزرعهٔ حساب / چکش‌کاری) را همان‌جا رد می‌کند.
 * فقط یک نگاه به Map درون‌حافظه است؛ هزینهٔ عادی صفر است.
 * trustProxy فعال است → req.ip همان IP واقعی پشت پروکسی است.
 */
@Injectable()
export class SecurityGuard implements CanActivate {
  constructor(private readonly security: SecurityService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<
      { ip?: string } & Record<string, unknown>
    >();
    this.security.assertIpAllowed(req.ip);
    return true;
  }
}
