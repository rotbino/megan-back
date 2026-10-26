import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** کاربر احرازشده — روی request توسط JwtAuthGuard گذاشته می‌شود */
export interface AuthUser {
  id: string; // ObjectId
  phone: string;
  role: string;
}

/**
 * گارد توکن — هدر `Authorization: Bearer <accessToken>`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequestWithUser>();
    const header: string | undefined = request.headers?.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'برای این عملیات ابتدا وارد حساب خود شوید.',
      });
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; phone: string; role: string }>(
        header.slice('Bearer '.length).trim(),
      );
      request.userId = payload.sub;
      request.phone = payload.phone;
      request.role = payload.role;
      return true;
    } catch {
      throw new UnauthorizedException({
        code: 'AUTH_EXPIRED',
        message: 'نشست شما منقضی شده است؛ دوباره وارد شوید.',
      });
    }
  }
}

// گارد نقش ادمینِ توکن‌کاربر (AdminGuard) در فاز A5 حذف شد — همه مسیرهای
// ادمین حالا زیر admin/* با AdminJwtAuthGuard (کالکشن AdminUser جدا) هستند.

/** تایپ کمکی برای request تزئین‌شده توسط گارد */
export interface FastifyRequestWithUser {
  headers: Record<string, unknown> & { authorization?: string };
  userId?: string;
  phone?: string;
  role?: string;
}
