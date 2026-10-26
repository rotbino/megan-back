import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.module';
import { adminJwtSecret } from '../../common/config/env';

/** کاربر ادمین احرازشده — روی request توسط AdminJwtAuthGuard گذاشته می‌شود */
export interface AdminAuthUser {
  adminId: string; // ObjectId در AdminUser
  username: string;
  role: string; // SUPER_ADMIN | ADMIN
}

export interface FastifyRequestWithAdmin {
  headers: Record<string, unknown> & { authorization?: string };
  adminId?: string;
  adminUsername?: string;
  adminRole?: string;
}

/**
 * گارد توکن ادمین — کاملاً جدا از JwtAuthGuard کاربران:
 *  • راز جدا (ADMIN_JWT_SECRET — از JWT_SECRET مشتق اگر ست نشده)
 *  • ادعای scope='admin' الزامی → توکن کاربر عادی هرگز قبول نمی‌شود
 *  • وضعیت زنده ادمین از DB چک می‌شود (حذف/غیرفعال → 401 فوری)
 */
@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequestWithAdmin>();
    const header: string | undefined = request.headers?.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'ADMIN_AUTH_REQUIRED',
        message: 'برای پنل مدیریت ابتدا وارد شوید.',
      });
    }

    let payload: { sub: string; username: string; role: string; scope: string };
    try {
      // راز جدا از کاربران عادی — توکن کاربر عادی اینجا reject می‌شود
      payload = await this.jwt.verifyAsync(header.slice('Bearer '.length).trim(), {
        secret: adminJwtSecret(),
      });
    } catch {
      throw new UnauthorizedException({
        code: 'ADMIN_AUTH_EXPIRED',
        message: 'نشست مدیریت منقضی شده است؛ دوباره وارد شوید.',
      });
    }

    if (payload.scope !== 'admin' || !payload.sub) {
      throw new UnauthorizedException({
        code: 'ADMIN_AUTH_INVALID',
        message: 'اعتبارنامه مدیریت معتبر نیست.',
      });
    }

    // وضعیت زنده — ادمین غیرفعال/حذف‌شده بلافاصله بیرون می‌رود
    const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException({
        code: 'ADMIN_AUTH_INVALID',
        message: 'حساب مدیریت غیرفعال است.',
      });
    }

    request.adminId = admin.id;
    request.adminUsername = admin.username;
    request.adminRole = admin.role;
    return true;
  }
}
