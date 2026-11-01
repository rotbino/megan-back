import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import type { AuthUser } from '../common/guards';
import type { ReportCallDto } from './dto';

const OID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * پنجره ضد-تکرار (دقیقه) — باز و بسته کردن دیالوگ شماره نباید هر بار
 * «یک تماس» بشمارد؛ بازبینی مجدد شماره همان کاربر در این بازه فقط
 * همان رکورد قبلی را تازه می‌کند. تماس واقعی جدا (اگر روزی سیگنال
 * تلفنی داشتیم) ثبت خواهد شد.
 */
const DEDUPE_WINDOW_MIN = 60;

/**
 * سهمیهٔ تماس روزانه (خواستهٔ مالک ۱-۱۱ — امنیت شماره‌های موبایل):
 * رایگان = ۱۰ کاربر در روز، بستهٔ فعال = ۳۰ کاربر در روز.
 * شمارش «کاربرهای متمایز» است — دیدن دوبارهٔ شمارهٔ همان کاربر در همان
 * روز سهمیهٔ تازه نمی‌گیرد (هم‌راستا با ضد-تکرار ۶۰ دقیقه‌ای).
 */
export const FREE_DAILY_CALL_LIMIT = 10;
export const PAID_DAILY_CALL_LIMIT = 30;

export function dailyCallLimit(activePakageType: number): number {
  return activePakageType > 0 ? PAID_DAILY_CALL_LIMIT : FREE_DAILY_CALL_LIMIT;
}

/** نیمه‌شب تهران به‌عنوان لحظهٔ UTC — ایران +03:30 ثابت (بدون ساعت تابستانی) */
export function tehranDayStartUtc(now = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // YYYY-MM-DD
  return new Date(`${ymd}T00:00:00+03:30`);
}

/**
 * گزارش تماس کاربر-به-کاربر (A6) + سهمیهٔ روزانه (۱-۱۱).
 *
 * در مدل MVP ایمچ، خریدار شماره فروشنده را روی سایت می‌بیند و بیرون از
 * سایت زنگ می‌زند؛ وب نمی‌تواند تماس واقعی را ببیند — اما لحظه‌ی
 * «آشکارسازی شماره» بهترین جانشین است و دقیقاً همان چیزی است که مالک
 * برای سنجش حجم ارتباطات کاربران لازم دارد. ثبت best-effort و بی‌صدا
 * است؛ شکستش تجربه خریدار را خراب نمی‌کند. سهمیهٔ روزانه اما سخت است —
 * مسیر اصلی دزدی داده همین آشکارسازی است.
 */
@Injectable()
export class CallsService {
  constructor(private readonly prisma: PrismaService) {}

  /** کاربرهایی که امروز (روز تهران) شماره‌شان برای این تماس‌گیرنده آشکار شده */
  async contactedToday(callerId: string): Promise<Set<string>> {
    const since = tehranDayStartUtc();
    const rows = await this.prisma.callLog.findMany({
      where: { callerId, createdAt: { gte: since } },
      select: { calleeId: true },
      distinct: ['calleeId'],
    });
    return new Set(rows.map((r) => r.calleeId));
  }

  /**
   * گیت سهمیهٔ روزانه — قبل از آشکارسازی هر شمارهٔ تازه صدا زده می‌شود.
   * خودِ هدف امروز دیده شده باشد سهمیه نمی‌سوزد (بازبینی مجدد).
   */
  async assertDailyQuota(caller: AuthUser, targetUserId: string, activePakageType: number): Promise<void> {
    if (caller.id === targetUserId) return; // شمارهٔ خودم — سهمیه ندارد
    const contacted = await this.contactedToday(caller.id);
    if (contacted.has(targetUserId)) return;
    if (contacted.size >= dailyCallLimit(activePakageType)) {
      throw AppError.forbidden(
        activePakageType > 0
          ? `سقف تماس‌های امروز شما (${PAID_DAILY_CALL_LIMIT} کاربر) پر شده است؛ فردا دوباره امکان‌پذیر است.`
          : `سهمیهٔ تماس رایگان امروز شما (${FREE_DAILY_CALL_LIMIT} کاربر) تمام شد؛ با فعال‌سازی یکی از بسته‌های ایمچ تا ${PAID_DAILY_CALL_LIMIT} تماس روزانه خواهید داشت.`,
        'CALL_DAILY_LIMIT',
      );
    }
  }

  /**
   * POST /calls/reportCall — ثبت «تماس‌گیری» هنگام آشکارسازی شماره.
   * خودتماسی معنا ندارد؛ کاربر غیرفعال/حذف‌شده خطا می‌دهد.
   */
  async reportCall(user: AuthUser, dto: ReportCallDto) {
    if (!OID_RE.test(dto.calleeId)) throw AppError.badRequest('شناسه کاربر معتبر نیست.');

    const callee = await this.prisma.user.findUnique({
      where: { id: dto.calleeId },
      select: { id: true, isActive: true },
    });
    if (!callee || !callee.isActive) throw AppError.notFound('کاربر یافت نشد.');
    if (callee.id === user.id) throw AppError.badRequest('گزارش تماس با خودتان معنا ندارد.');

    // آگهی زمینه — اگر داده شد باید واقعی باشد
    if (dto.productId != null) {
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: { id: true },
      });
      if (!product) throw AppError.notFound('آگهی یافت نشد.');
    }

    // ضد-تکرار جفتی (خریدار↔فروشنده) — شماره تلفن به کاربر تعلق دارد نه
    // آگهی؛ دیدن دوباره شماره همان فروشنده از آگهی/پروفایل دیگر در پنجره
    // ۶۰ دقیقه‌ای همان تماس قبلی است. productId فقط زمینه اولین رکورد می‌ماند.
    const since = new Date(Date.now() - DEDUPE_WINDOW_MIN * 60_000);
    const existing = await this.prisma.callLog.findFirst({
      where: {
        callerId: user.id,
        calleeId: dto.calleeId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return { id: existing.id, createdAt: existing.createdAt, repeated: true };
    }

    const log = await this.prisma.callLog.create({
      data: {
        callerId: user.id,
        calleeId: dto.calleeId,
        source: dto.source ?? 'product',
        ...(dto.productId != null ? { productId: dto.productId } : {}),
      },
    });
    return { id: log.id, createdAt: log.createdAt, repeated: false };
  }
}
