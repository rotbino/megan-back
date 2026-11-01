import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';
import { forceUserDeparture } from '../chat/io-holder';

/** چکش‌کاری آشکارسازی چند برابرِ سهمیه → بلاک خودکار کاربر و شماره‌اش */
const ABUSE_MULTIPLE = 3;
/** یک IP پشت چند کاربرِ در حال آشکارسازی = مزرعهٔ حساب */
const IP_FARM_USERS = 5;
const IP_FARM_WINDOW_MS = 60 * 60 * 1000; // پنجرهٔ ۱ ساعته
const IP_BLOCK_MS = 24 * 60 * 60 * 1000; // بلاک IP: ۲۴ ساعت
/** دورهٔ نگهداری شمارنده‌ها (پنجرهٔ روزانه) */
const COUNTER_TTL_MS = 24 * 60 * 60 * 1000;

interface UserCounter {
  /** مهر تلاش‌های آشکارسازی — هر تلاش (موفق/ردشده) یکی */
  attempts: number[];
}

interface IpCounter {
  /** مهر تلاش‌ها + شناسهٔ کاربرِ هر تلاش — برای شمارش کاربرهای متمایز */
  hits: Array<{ at: number; userId: string }>;
}

/**
 * سرویس امنیت — تشخیص و بلاک الگوهای دزدی داده (خواستهٔ مالک ۱-۱۱).
 *
 * هدف حملات: برداشت انبوه شماره‌های موبایل از سرویس‌های آشکارسازی
 * (getSellerPhone / getBuyRequestContact). سهمیهٔ روزانه سرعت را می‌گیرد؛
 * این سرویس الگوی پشت آن (چکش‌کاری / مزرعهٔ حساب) را هم می‌بیند و
 * کاربر + شمارهٔ موبایلش را تا اطلاع بعدی پشتیبانی بلاک می‌کند:
 * isActive=false → ورود مسدود (همان پیام همیشگی حساب غیرفعال) و همهٔ
 * نشست‌های باز همان لحظه باطل می‌شوند.
 */
@Injectable()
export class SecurityService implements OnModuleDestroy {
  private userCounters = new Map<string, UserCounter>();
  private ipCounters = new Map<string, IpCounter>();
  private blockedIps = new Map<string, number>(); // ip → تا کِی
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {
    // پاک‌سازی دوره‌ای شمارنده‌های کهنه — هر ۳۰ دقیقه
    this.sweeper = setInterval(() => this.sweep(), 30 * 60 * 1000);
    this.sweeper.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  private sweep(): void {
    const cutoff = Date.now() - COUNTER_TTL_MS;
    for (const [ip, until] of this.blockedIps) {
      if (until < Date.now()) this.blockedIps.delete(ip);
    }
    for (const [uid, c] of this.userCounters) {
      c.attempts = c.attempts.filter((t) => t >= cutoff);
      if (c.attempts.length === 0) this.userCounters.delete(uid);
    }
    for (const [ip, c] of this.ipCounters) {
      c.hits = c.hits.filter((h) => h.at >= cutoff);
      if (c.hits.length === 0) this.ipCounters.delete(ip);
    }
  }

  /** IP بلاک شده؟ — گارد سراسری روی هر درخواست صدا می‌زند (ارزان: Map) */
  assertIpAllowed(ip: string | undefined): void {
    if (!ip) return;
    const until = this.blockedIps.get(ip);
    if (until && until > Date.now()) {
      throw AppError.forbidden('دسترسی شما به‌صورت موقت محدود شده است.', 'IP_BLOCKED');
    }
    if (until) this.blockedIps.delete(ip);
  }

  /** بلاک IP — مزرعهٔ حساب یا چکش‌کاری از یک IP */
  blockIp(ip: string | undefined): void {
    if (!ip) return;
    this.blockedIps.set(ip, Date.now() + IP_BLOCK_MS);
  }

  /**
   * ثبت تلاش آشکارسازی شماره — قبل از هر getSellerPhone /
   * getBuyRequestContact صدا زده می‌شود (موفق یا ردشده فرقی ندارد؛
   * چکش‌کاریِ ردشده هم سیگنال حمله است).
   *
   * @param dailyLimit سهمیهٔ روزانهٔ کاربر (۱۰ رایگان / ۳۰ بسته)
   */
  async noteContactReveal(userId: string, ip: string | undefined, dailyLimit: number): Promise<void> {
    const now = Date.now();
    const cutoff = now - COUNTER_TTL_MS;

    // شمارندهٔ کاربر — چکش‌کاری چند برابر سهمیه = دزدی داده
    const uc = this.userCounters.get(userId) ?? { attempts: [] };
    uc.attempts = uc.attempts.filter((t) => t >= cutoff);
    uc.attempts.push(now);
    this.userCounters.set(userId, uc);
    if (uc.attempts.length > dailyLimit * ABUSE_MULTIPLE) {
      await this.blockUser(userId, `AUTO_BLOCK: ${uc.attempts.length} contact-reveal attempts in 24h (limit ${dailyLimit})`);
      throw AppError.forbidden(
        'دسترسی شما به اطلاعات تماس به دلیل فعالیت غیرعادی محدود شد؛ با پشتیبانی ایمچ تماس بگیرید.',
        'REVEAL_ABUSE_BLOCKED',
      );
    }

    // شمارندهٔ IP — یک IP پشت چند کاربرِ مختلف = مزرعهٔ حساب/توکن‌دزدی
    if (ip) {
      const ic = this.ipCounters.get(ip) ?? { hits: [] };
      ic.hits = ic.hits.filter((h) => h.at >= now - IP_FARM_WINDOW_MS);
      ic.hits.push({ at: now, userId });
      this.ipCounters.set(ip, ic);
      const distinctUsers = new Set(ic.hits.map((h) => h.userId)).size;
      if (distinctUsers > IP_FARM_USERS) {
        this.blockIp(ip);
      }
    }
  }

  /**
   * بلاک کاربر و شمارهٔ موبایلش (تا رفع توسط پشتیبانی):
   *  • isActive=false → ورود بعدی رد می‌شود؛ ثبت‌نام دوباره با همان شماره هم
   *    به همین رکورد می‌خورد و رد می‌شود (شماره unique است).
   *  • sessionsRevokedAt=اکنون → هر اکسس‌توکن صادرشده همان لحظه می‌میرد.
   *  • همهٔ رفرش‌توکن‌ها باطل + کش نشست بیات + سوکت چت قطع.
   */
  async blockUser(userId: string, reason: string): Promise<void> {
    const now = new Date();
    // ردیف ADMIN هرگز بلاک نشود (حفاظت در برابر خطای شمارنده)
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isActive: true },
    });
    if (!user || user.role === 'ADMIN') return;
    if (!user.isActive) {
      // قبلاً بلاک شده — فقط اطمینان از ابطال نشست‌ها
      await this.revokeSessions(userId, now);
      return;
    }
    // eslint-disable-next-line no-console -- ردپای امنیتی برای پشتیبانی/ادمین (بدون شمارهٔ موبایل)
    console.warn(`[security] user blocked — ${reason} | user=${userId}`);
    // شمارندهٔ تلاش‌ها صفر می‌شود تا اگر پشتیبانی بعداً کاربر را آزاد کرد،
    // همان لحظه دوباره بلاک نشود (پنجرهٔ تازه از همین به بعد شمرده می‌شود)
    this.userCounters.delete(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false, sessionsRevokedAt: now },
    });
    await this.revokeSessions(userId, now);
  }

  private async revokeSessions(userId: string, now: Date): Promise<void> {
    await this.prisma.refreshToken
      .updateMany({ where: { userId }, data: { revokedAt: now } })
      .catch(() => undefined);
    this.cache.invalidate(`user:alive:${userId}`);
    forceUserDeparture(userId);
  }
}
