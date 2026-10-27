import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from './prisma/prisma.module';
import { CacheService, TTL } from './cache/cache.module';

/** کاربر احرازشده — روی request توسط JwtAuthGuard گذاشته می‌شود */
export interface AuthUser {
  id: string; // ObjectId
  phone: string;
  role: string;
}

/** payload توکن — iat برای مقایسه با مهر ابطال نشست‌ها */
interface JwtPayload {
  sub: string;
  phone: string;
  role: string;
  iat?: number;
}

/**
 * گارد توکن — هدر `Authorization: Bearer <accessToken>`.
 *
 * علاوه بر امضای JWT، «زنده بودن نشست» را هم چک می‌کند (لاگ‌اوت سمت سرور):
 * اگر کاربر خارج شده باشد (sessions_revoked_at)، هر توکنی که قبل از آن
 * صادر شده باشد فوراً باطل است — حتی اگر امضایش تا ۷ روز معتبر باشد.
 * وضعیت کاربر ۳۰ ثانیه کش می‌شود تا DB در هر درخواست له نشود؛
 * لاگ‌اوت همان لحظه کش را ابطال می‌کند.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequestWithUser>();
    const payload = await this.verifyHeader(request);
    await this.ensureSessionAlive(payload);
    request.userId = payload.sub;
    request.phone = payload.phone;
    request.role = payload.role;
    return true;
  }

  /** امضای توکن از هدر — پرتاب AUTH_REQUIRED / AUTH_EXPIRED */
  protected async verifyHeader(request: FastifyRequestWithUser): Promise<JwtPayload> {
    const header: string | undefined = request.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'برای این عملیات ابتدا وارد حساب خود شوید.',
      });
    }
    try {
      return await this.jwt.verifyAsync<JwtPayload>(header.slice('Bearer '.length).trim());
    } catch {
      throw new UnauthorizedException({
        code: 'AUTH_EXPIRED',
        message: 'نشست شما منقضی شده است؛ دوباره وارد شوید.',
      });
    }
  }

  /** نشست هنوز زنده است؟ — کاربر موجود/فعال و توکن بعد از آخرین ابطال صادر شده */
  protected async ensureSessionAlive(payload: JwtPayload): Promise<void> {
    const state = await this.cache.wrap(
      `user:alive:${payload.sub}`,
      { ttlMs: TTL.SHORT }, // ۳۰ ثانیه — لاگ‌اوت کش را دستی ابطال می‌کند
      () =>
        this.prisma.user
          .findUnique({
            where: { id: payload.sub },
            select: { isActive: true, sessionsRevokedAt: true },
          })
          .then((u) =>
            u
              ? {
                  isActive: u.isActive,
                  revokedMs: u.sessionsRevokedAt ? u.sessionsRevokedAt.getTime() : 0,
                }
              : null,
          ),
    );

    if (!state || !state.isActive) {
      throw new UnauthorizedException({
        code: 'AUTH_EXPIRED',
        message: 'نشست شما منقضی شده است؛ دوباره وارد شوید.',
      });
    }
    if (payload.iat && payload.iat * 1000 <= state.revokedMs) {
      // توکن قبل از لاگ‌اوت صادر شده — سمت سرور باطل است
      throw new UnauthorizedException({
        code: 'AUTH_EXPIRED',
        message: 'نشست شما منقضی شده است؛ دوباره وارد شوید.',
      });
    }
  }
}

// گارد نقش ادمینِ توکن‌کاربر (AdminGuard) در فاز A5 حذف شد — همه مسیرهای
// ادمین حالا زیر admin/* با AdminJwtAuthGuard (کالکشن AdminUser جدا) هستند.

/**
 * گارد اختیاری — توکن باشد اعتبارسنجی و userId را می‌گذارد؛ نباشد/خراب
 * باشد هم درخواست رد نمی‌شود (request.userId خالی می‌ماند). برای اندپوینت‌های
 * عمومی مثل «گرفتن شماره فروشنده» که اگر خریدار وارد شده باشد، تماسش
 * ثبت می‌شود و اگر مهمان باشد فقط شماره را می‌بیند.
 *
 * توکنِ نشستِ باطل‌شده هم مثل مهمان رفتار می‌شود (نه خطا).
 */
@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequestWithUser>();
    const header: string | undefined = request.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) return true;
    try {
      const payload = await this.verifyHeader(request);
      await this.ensureSessionAlive(payload);
      request.userId = payload.sub;
      request.phone = payload.phone;
      request.role = payload.role;
    } catch {
      /* توکن خراب/منقضی/ابطال‌شده — مثل مهمان ادامه بده */
    }
    return true;
  }
}

/** تایپ کمکی برای request تزئین‌شده توسط گارد */
export interface FastifyRequestWithUser {
  headers: Record<string, unknown> & { authorization?: string };
  userId?: string;
  phone?: string;
  role?: string;
}
