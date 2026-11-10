import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import { LocationsService } from '../locations/locations.service';
import { effectivePakageType } from '../packages/packages.service';
import type { UpdateBookSettingsDto } from './dto';

/** قاعدهٔ آیدی سفارشی دفتر — عین استاب سندباکس و فرانت (مودال تنظیمات) */
const BOOKID_RE = /^[a-z0-9-]{3,30}$/;
const BOOKID_HINT =
  'آیدی دفتر خرید باید ۳ تا ۳۰ نویسه باشد؛ فقط حروف کوچک لاتین، رقم و خط تیره (-).';
const BOOKID_TAKEN = 'این آیدی قبلاً گرفته شده است؛ یکی دیگر انتخاب کنید.';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
/** سقف URL لوگو — عین استاب */
const LOGO_MAX = 600;
/** سقف ذخیره‌شده‌ها — هم‌قاعدهٔ کاتالوگ و علاقه‌مندی‌ها */
const SAVED_LIMIT = 200;
/** نشان «فعال در ۷ روز اخیر» — عین دایرکتوری خریداران */
const RECENT_WINDOW_MS = 7 * 86_400_000;
/** تلاش تولید آیدی تصادفی آزاد */
const FRESH_RETRIES = 10;

/** قالب تاریخ باسکول — یکدست با بقیهٔ API */
const fmtDate = (d: Date | null | undefined): string =>
  d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : '';

/** ISO یا null — برای مهرهای حضور که فرانت با RelativeTime نشان می‌دهد */
const fmtIso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/** نقش نمایشی از حجم خرید — عین buyers.service (کپی برای استقلال ماژول) */
function buyerRole(unit: string, volumeMin: number): 'عمده‌خریدار' | 'خرده‌خریدار' {
  if (unit === 'تن') return 'عمده‌خریدار';
  if (unit === 'کیلوگرم' && volumeMin >= 1000) return 'عمده‌خریدار';
  if ((unit === 'عدد' || unit === 'بسته' || unit === 'متر' || unit === 'لیتر') && volumeMin >= 5000) {
    return 'عمده‌خریدار';
  }
  return 'خرده‌خریدار';
}

/** تنظیمات دفترِ حل‌شده — هم‌شکل BuyerBookSettings فرانت (lib/types.ts) و
 *  استاب سندباکس؛ مقدار null = پیش‌فرض ایمچ (رنگ/لوگو) */
export interface BuyerBookSettingsDto {
  /** بخش آخر لینک عمومی — همیشه پس از ensure مقدار دارد */
  bookId: string | null;
  /** رنگ برند hex — null = رنگ پیش‌فرض ایمچ */
  brandColor: string | null;
  /** URL لوگوی آپلودی — null = آواتار/حرف اول نام خریدار */
  logo: string | null;
}

/** مشخصات خریدار — کارت هویت صفحهٔ عمومی */
export interface BuyerBookBuyerInfoDto {
  userName: string;
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  role: 'عمده‌خریدار' | 'خرده‌خریدار';
  provinceName: string | null;
  cityName: string | null;
  createdAt: string;
  daysInImach: number;
  lastActiveAt: string | null;
  activeRecently: boolean;
}

/** کالای دفتر — هم‌شکل BuyerBookItem فرانت؛ فقط confirmed عمومی است */
export interface BuyerBookItemDto {
  categoryId: number;
  name: string;
  rootName: string;
  parentName: string;
  unit: string;
  minAmount: number;
  period: string;
  productType: string | null;
  example: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  rejectionReasons: string[];
}

/** ردیف «دفاتر ذخیره شده» پنل فروشنده — لیست مشتری بالقوه */
export interface SavedBuyerBookRowDto {
  buyerUserName: string;
  buyerId: string;
  buyerName: string;
  avatarUrl: string | null;
  cityName: string | null;
  itemCount: number;
  bookId: string | null;
  savedAt: string;
  lastActiveAt: string | null;
}

/** حداقل دیتای کاربر که حل تنظیمات نیاز دارد */
interface UserBrief {
  id: string;
  userName: string;
  firstName: string;
  lastName: string;
}

/** ردیف UserBuyerBook که سرویس می‌خواند */
interface BookRow {
  id: string;
  bookId: string;
  brandColor: string | null;
  logo: string | null;
}

/**
 * ─── دفتر خرید (خواسته مالک ۱۰-۱۱ دور ۵) ──────────────────────────────────
 *
 * قرینهٔ کاتالوگ فروشنده: فروشنده کاتالوگ دارد (/c/{catalogId}) که خریدار
 * ذخیره می‌کند؛ خریدار دفتر خرید دارد (/b/{bookId}) — کالاهای خرید دوره‌ای‌اش
 * از BuyerCategory — که فروشندهٔ دارندهٔ بسته ذخیره می‌کند: لیست مشتری
 * بالقوه در تب «دفاتر ذخیره شده» پنل خریداران.
 *
 *  • آیدی لینک (/b/{bookId}) برخلاف کاتالوگ پیش‌فرضِ «تصادفی» دارد و با
 *    اولین نیاز ساخته می‌شود (خواستهٔ مالک: لینک سند شخصی خریدار است و
 *    userName او نباید از لینک لو برود).
 *  • محتوای دفتر (کالاها/مشخصات خریدار) پشت گیت است: فقط خودِ خریدار یا
 *    دارندهٔ بستهٔ فعال ایمچ (NEED_PACKAGE) — پوستهٔ برند SSR عمومی است.
 *  • فقط کالاهای confirmed عمومی می‌شوند — ردیف تازه تا بازبینی ادمین
 *    پنهان است (عین دایرکتوری خریداران).
 *
 * قرارداد کامل و دادهٔ نمونه در استاب سندباکس (megan-web/scripts/stub-backend.mjs)
 * مستند است — پیام‌های خطا عیناً همان‌ها هستند تا UX فرانت یکدست بماند.
 */
@Injectable()
export class BuyerBookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
  ) {}

  // ─── شخصی‌سازی (پنل خریدار → مودال تنظیمات دفتر خرید) ─────────────────

  /** آیدی دفتر خریداران — برای دایرکتوری خریداران (لینک ظریف فوتر کارت).
   *  دفترِ بدون ردیف همین‌جا با آیدی تصادفی ساخته می‌شود تا همهٔ صاحبان
   *  دفتر لینک سالم داشته باشند (خواستهٔ مالک ۱۰-۱۱ دور ۵ — عین استاب). */
  async ensureBookIds(userIds: string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(userIds)];
    if (uniq.length === 0) return new Map();
    const rows = await this.prisma.userBuyerBook.findMany({
      where: { userId: { in: uniq } },
      select: { userId: true, bookId: true },
    });
    const map = new Map(rows.map((r) => [r.userId, r.bookId]));
    const missing = uniq.filter((id) => !map.has(id));
    // ساخت ترتیبی — فقط یک‌بار در عمر هر کاربر؛ خواندن‌های بعدی سبک‌اند
    for (const id of missing) {
      const row = await this.ensureBookRow(id);
      map.set(id, row.bookId);
    }
    return map;
  }

  /** POST /buyerBook/getMySettings — تنظیمات خودم؛ با اولین خواندن، ردیف با
   *  آیدی تصادفیِ پیش‌فرض ساخته می‌شود (همیشه پر برمی‌گردد). */
  async getMySettings(userId: string): Promise<{ settings: BuyerBookSettingsDto }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw AppError.notFound('کاربر یافت نشد.');
    const row = await this.ensureBookRow(userId);
    return { settings: this.resolvedSettings(row) };
  }

  /** POST /buyerBook/updateSettings — ذخیرهٔ تنظیمات؛ فقط فیلدهای ارسالی
   *  عوض می‌شوند. خطای ۴۰۰ (قالب) و ۴۰۹ (آیدی تکراری) با پیام فارسی —
   *  عین استاب؛ فرانت همان پیام را در مودال نشان می‌دهد. */
  async updateSettings(
    userId: string,
    dto: UpdateBookSettingsDto,
  ): Promise<{ settings: BuyerBookSettingsDto }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw AppError.notFound('کاربر یافت نشد.');

    /** تغییرات مرحله‌ای — فقط بعد از عبور همهٔ ولیدیشن‌ها نوشته می‌شود */
    const patch: Partial<{ bookId: string; brandColor: string | null; logo: string | null }> = {};

    if (dto.bookId !== undefined) {
      const id = String(dto.bookId ?? '').trim().toLowerCase();
      if (!BOOKID_RE.test(id) || /^-|-$/.test(id)) {
        throw AppError.badRequest(BOOKID_HINT, 'INVALID_BOOK_ID');
      }
      const owner = await this.bookIdOwner(id, userId);
      if (owner) throw AppError.conflict(BOOKID_TAKEN, 'BOOK_ID_TAKEN');
      patch.bookId = id;
    }
    if (dto.brandColor !== undefined) {
      const bc = String(dto.brandColor ?? '').trim();
      if (bc && !HEX_RE.test(bc)) {
        throw AppError.badRequest('رنگ برند نامعتبر است (مثال: #0891b2).', 'INVALID_BRAND_COLOR');
      }
      patch.brandColor = bc ? bc.toLowerCase() : null;
    }
    if (dto.logo !== undefined) {
      const lg = String(dto.logo ?? '').trim();
      if (lg.length > LOGO_MAX) {
        throw AppError.badRequest('آدرس لوگو نامعتبر است.', 'INVALID_LOGO');
      }
      patch.logo = lg || null;
    }

    // ردیف پایه با آیدی تصادفی ساخته می‌شود (اگر نیست) و بعد پچ می‌خورد؛
    // تصادم مسابقه‌ای روی ایندکس یکتای bookId → همان ۴۰۹ دوستانه
    const base = await this.ensureBookRow(userId);
    const row = await this.prisma.userBuyerBook
      .update({ where: { id: base.id }, data: { ...patch, updatedAt: new Date() }, select: BOOK_SELECT })
      .catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw AppError.conflict(BOOKID_TAKEN, 'BOOK_ID_TAKEN');
        }
        throw e;
      });
    return { settings: this.resolvedSettings(row) };
  }

  // ─── صفحهٔ عمومی /b/{id} ───────────────────────────────────────────────

  /** POST /buyerBook/resolvePublicId — رزولو آیدی عمومی؛ id می‌تواند آیدی
   *  سفارشی یا userName خریدار باشد. null = ناشناخته (فرانت ۴۰۴ می‌کند).
   *  کاربر غیرفعال عملاً دفتر ندارد → null (عین کاتالوگ). با اولین رزولو،
   *  ردیف تنظیمات با آیدی تصادفی ساخته می‌شود — لینک اشتراک همیشه سالم. */
  async resolvePublicId(
    raw: string,
  ): Promise<{ userName: string; name: string; settings: BuyerBookSettingsDto } | null> {
    const id = (raw ?? '').trim().toLowerCase();
    if (!id) return null;

    // ۱) آیدی سفارشی کسی؟
    const byCustom = await this.prisma.userBuyerBook.findUnique({
      where: { bookId: id },
      select: { ...BOOK_SELECT, user: { select: { ...USER_BRIEF_SELECT, isActive: true } } },
    });
    if (byCustom?.user.isActive) {
      const { user, ...row } = byCustom;
      return {
        userName: user.userName,
        name: `${user.firstName} ${user.lastName}`.trim(),
        settings: this.resolvedSettings(row),
      };
    }

    // ۲) خودِ userName خریدار؟ (fallback — لینک‌های قدیمی/اشتراک با userName)
    const user = await this.prisma.user.findUnique({
      where: { userName: id },
      select: { ...USER_BRIEF_SELECT, isActive: true },
    });
    if (!user?.isActive) return null;
    const row = await this.ensureBookRow(user.id);
    return {
      userName: user.userName,
      name: `${user.firstName} ${user.lastName}`.trim(),
      settings: this.resolvedSettings(row),
    };
  }

  /** POST /buyerBook/getPublic — دیتای کامل دفتر (گیت: مالک یا دارندهٔ بستهٔ
   *  فعال — خواستهٔ مالک). null = دفتر ناشناخته؛ ۴۰۳ NEED_PACKAGE = قفل
   *  و دعوت به خرید بسته در فرانت. */
  async getPublic(
    viewerId: string,
    raw: string,
  ): Promise<{
    buyer: BuyerBookBuyerInfoDto;
    items: BuyerBookItemDto[];
    saversCount: number;
    settings: BuyerBookSettingsDto;
  } | null> {
    const buyer = await this.findBuyerByPublicId(raw);
    if (!buyer) return null;

    // گیت (خواستهٔ مالک): فقط مالک دفتر یا دارندهٔ بستهٔ فعال
    if (buyer.id !== viewerId) {
      const me = await this.prisma.user.findUnique({
        where: { id: viewerId },
        select: { activePakageType: true, packageExpiresAt: true, isActive: true },
      });
      if (!me || !me.isActive) throw AppError.forbidden('حساب شما در دسترس نیست.');
      const active = effectivePakageType(me.activePakageType, me.packageExpiresAt);
      if (active <= 0) {
        throw AppError.forbidden(
          'مشاهدهٔ دفاتر خرید ویژهٔ کاربران دارندهٔ بستهٔ اشتراک فعال ایمچ است.',
          'NEED_PACKAGE',
        );
      }
    }

    // کالاهای تاییدشده — ردیف pending/rejected عمومی نیست (عین استاب/دایرکتوری)
    const [rows, row, saversCount] = await Promise.all([
      this.prisma.buyerCategory.findMany({
        where: { userId: buyer.id, status: 'confirmed' },
        orderBy: { createdAt: 'asc' },
        select: {
          categoryId: true,
          volumeMin: true,
          period: true,
          unit: true,
          goodId: true,
          status: true,
          rejectionReasons: true,
        },
      }),
      this.ensureBookRow(buyer.id),
      this.prisma.savedBuyerBook.count({ where: { book: { userId: buyer.id } } }),
    ]);
    const items = await this.mapItems(rows);

    // نقش نمایشی — اگر حتی یک کالای تاییدشده‌اش عمده است، خریدار عمده است
    const role: BuyerBookBuyerInfoDto['role'] = rows.some(
      (r) => buyerRole(r.unit, r.volumeMin) === 'عمده‌خریدار',
    )
      ? 'عمده‌خریدار'
      : 'خرده‌خریدار';

    const last = buyer.lastSeenAt ?? buyer.createdAt;
    const [avatarMap, placeNames] = await Promise.all([
      this.avatarMap([buyer.id]),
      this.locations.getNames(
        buyer.provinceId != null ? [buyer.provinceId] : [],
        buyer.cityId != null ? [buyer.cityId] : [],
      ),
    ]);

    return {
      buyer: {
        userName: buyer.userName,
        id: buyer.id,
        firstName: buyer.firstName,
        lastName: buyer.lastName,
        avatarUrl: avatarMap.get(buyer.id) ?? null,
        role,
        provinceName: buyer.provinceId != null ? (placeNames.provinces.get(buyer.provinceId) ?? null) : null,
        cityName: buyer.cityId != null ? (placeNames.cities.get(buyer.cityId) ?? null) : null,
        createdAt: fmtDate(buyer.createdAt),
        daysInImach: Math.max(
          1,
          Math.round((Date.now() - buyer.createdAt.getTime()) / 86_400_000),
        ),
        lastActiveAt: fmtIso(last),
        activeRecently: Date.now() - last.getTime() < RECENT_WINDOW_MS,
      },
      items,
      saversCount,
      settings: this.resolvedSettings(row),
    };
  }

  // ─── دفترچهٔ ذخیرهٔ فروشنده (لیست مشتری بالقوه) ────────────────────────

  /** POST /buyerBook/isSaved — وضعیت دکمهٔ ذخیره برای فروشندهٔ واردشده.
   *  خریدارِ ناشناخته/بدون ردیف → false (بدون خطا — فرانت بی‌صدا تحمل می‌کند). */
  async isSaved(userId: string, buyerUserName: string): Promise<{ saved: boolean }> {
    const book = await this.buyerBookRow(buyerUserName);
    if (!book) return { saved: false };
    const row = await this.prisma.savedBuyerBook.findUnique({
      where: { userId_buyerBookId: { userId, buyerBookId: book.id } },
      select: { id: true },
    });
    return { saved: row != null };
  }

  /** POST /buyerBook/toggleSave — ذخیره/حذف ذخیرهٔ دفتر خرید (مثل کاتالوگ).
   *  دفترِ خریداری که هنوز ردیف ندارد لنگرِ ذخیره‌شده‌ها را ندارد → همان‌جا
   *  با آیدی تصادفی برایش ساخته می‌شود (خریدار بی‌عمل لینک سالم می‌گیرد). */
  async toggleSave(userId: string, buyerUserName: string): Promise<{ saved: boolean }> {
    const buyer = await this.findBuyer(buyerUserName);
    if (!buyer) throw AppError.notFound('دفتر خرید یافت نشد.');
    const book = await this.ensureBookRow(buyer.id);

    const existing = await this.prisma.savedBuyerBook.findUnique({
      where: { userId_buyerBookId: { userId, buyerBookId: book.id } },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.savedBuyerBook.delete({ where: { id: existing.id } });
      return { saved: false };
    }

    const count = await this.prisma.savedBuyerBook.count({ where: { userId } });
    if (count >= SAVED_LIMIT) {
      throw AppError.badRequest(
        `حداکثر ${SAVED_LIMIT} دفتر خرید قابل ذخیره است — ابتدا برخی را حذف کنید.`,
        'SAVED_BUYER_BOOKS_FULL',
      );
    }
    await this.prisma.savedBuyerBook.create({ data: { userId, buyerBookId: book.id } });
    return { saved: true };
  }

  /** POST /buyerBook/getMySaved — «دفاتر ذخیره شده» پنل فروشنده: لیست مشتری
   *  بالقوه با مشاهده/گفتگو/حذف — کارت سبک مثل کاتالوگ‌های ذخیره‌شده. */
  async getMySaved(userId: string): Promise<{ items: SavedBuyerBookRowDto[] }> {
    const rows = await this.prisma.savedBuyerBook.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: SAVED_LIMIT,
      include: {
        book: {
          include: {
            user: {
              select: {
                id: true,
                userName: true,
                firstName: true,
                lastName: true,
                cityId: true,
                lastSeenAt: true,
                createdAt: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    // خریدار غیرفعال = دفتر عملاً مرده — از لیست می‌افتد
    const alive = rows.filter((r) => r.book.user.isActive);
    const buyerIds = [...new Set(alive.map((r) => r.book.user.id))];

    const [avatarMap, cityNames, countRows] = await Promise.all([
      this.avatarMap(buyerIds),
      this.cityNames(alive.map((r) => r.book.user.cityId)),
      buyerIds.length
        ? this.prisma.buyerCategory.groupBy({
            by: ['userId'],
            where: { userId: { in: buyerIds }, status: 'confirmed' },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);
    const countMap = new Map(countRows.map((c) => [c.userId, c._count._all]));

    return {
      items: alive.map((r) => {
        const b = r.book.user;
        return {
          buyerUserName: b.userName,
          buyerId: b.id,
          buyerName: `${b.firstName} ${b.lastName}`.trim(),
          avatarUrl: avatarMap.get(b.id) ?? null,
          cityName: b.cityId != null ? (cityNames.get(b.cityId) ?? null) : null,
          itemCount: countMap.get(b.id) ?? 0,
          bookId: r.book.bookId,
          savedAt: fmtDate(r.createdAt),
          lastActiveAt: fmtIso(b.lastSeenAt ?? b.createdAt),
        };
      }),
    };
  }

  // ─── خصوصی‌ها ────────────────────────────────────────────────────────

  /** حل تنظیمات — عین استاب: مقادیر ذخیره‌شده؛ null رنگ/لوگو = پیش‌فرض ایمچ */
  private resolvedSettings(row: BookRow): BuyerBookSettingsDto {
    return { bookId: row.bookId, brandColor: row.brandColor, logo: row.logo };
  }

  /** ردیف دفتر کاربر — با اولین نیاز ساخته می‌شود و آیدی تصادفیِ پیش‌فرض
   *  می‌گیرد (خواستهٔ مالک ۱۰-۱۱ دور ۵). بازیابی P2002 برای هر دو ایندکس
   *  یکتا (userId و bookId) — مسابقهٔ هم‌زمانی بی‌صدا حل می‌شود. */
  private async ensureBookRow(userId: string): Promise<BookRow> {
    const existing = await this.prisma.userBuyerBook.findUnique({
      where: { userId },
      select: BOOK_SELECT,
    });
    if (existing) return existing;
    for (let attempt = 0; attempt < FRESH_RETRIES; attempt++) {
      const bookId = await this.freshBookId();
      try {
        return await this.prisma.userBuyerBook.create({
          data: { userId, bookId },
          select: BOOK_SELECT,
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const raced = await this.prisma.userBuyerBook.findUnique({
            where: { userId },
            select: BOOK_SELECT,
          });
          if (raced) return raced; // درخواست هم‌زمان ردیف را ساخت
          continue; // تصادم آیدی تصادفی — یک دور دیگر
        }
        throw e;
      }
    }
    throw AppError.conflict(
      'ساخت تنظیمات دفتر خرید ممکن نشد؛ دوباره تلاش کنید.',
      'BOOK_ID_RACE',
    );
  }

  /** آیدی تصادفی آزاد — «b» + ۷ نویسه base36 (مثل b7k2m9x)؛ یکتایی در برابر
   *  آیدی سفارشی دیگران و userName همهٔ کاربران چک می‌شود. */
  private async freshBookId(): Promise<string> {
    for (let i = 0; i < FRESH_RETRIES; i++) {
      const id = 'b' + Math.random().toString(36).slice(2, 9);
      if (!(await this.bookIdOwner(id, null))) return id;
    }
    throw AppError.conflict('تولید آیدی تصادفی ممکن نشد؛ دوباره تلاش کنید.', 'BOOK_ID_RACE');
  }

  /** آیدی عمومی آزاد است؟ — تداخل با آیدی سفارشی دیگران و userName هیچ
   *  کاربری (جز خودِ مالک) ممنوع. خروجی: null (آزاد) یا id تصاحب‌کننده. */
  private async bookIdOwner(id: string, exceptUserId: string | null): Promise<string | null> {
    const taken = await this.prisma.userBuyerBook.findFirst({
      where: { bookId: id, ...(exceptUserId ? { userId: { not: exceptUserId } } : {}) },
      select: { userId: true },
    });
    if (taken) return taken.userId;
    const user = await this.prisma.user.findUnique({ where: { userName: id }, select: { id: true } });
    return user && user.id !== exceptUserId ? user.id : null;
  }

  /** خریدار از آیدی عمومی (سفارشی یا userName) — با فیلدهای کارت هویت.
   *  ناشناخته/غیرفعال → null. */
  private async findBuyerByPublicId(raw: string): Promise<{
    id: string;
    userName: string;
    firstName: string;
    lastName: string;
    provinceId: number | null;
    cityId: number | null;
    createdAt: Date;
    lastSeenAt: Date | null;
  } | null> {
    const id = (raw ?? '').trim().toLowerCase();
    if (!id) return null;

    // ۱) آیدی سفارشی — رابطهٔ user جانشین findUnique روی where مرکب
    const byCustom = await this.prisma.userBuyerBook.findFirst({
      where: { bookId: id },
      select: {
        user: {
          select: {
            id: true,
            userName: true,
            firstName: true,
            lastName: true,
            provinceId: true,
            cityId: true,
            createdAt: true,
            lastSeenAt: true,
            isActive: true,
          },
        },
      },
    });
    if (byCustom?.user.isActive) return byCustom.user;

    // ۲) خودِ userName
    const user = await this.prisma.user.findUnique({
      where: { userName: id },
      select: {
        id: true,
        userName: true,
        firstName: true,
        lastName: true,
        provinceId: true,
        cityId: true,
        createdAt: true,
        lastSeenAt: true,
        isActive: true,
      },
    });
    return user?.isActive ? user : null;
  }

  /** خریدارِ ناشناخته → null؛ بریدن کلید یکسان با استاب (trim + lower) */
  private async findBuyer(buyerUserName: string): Promise<UserBrief | null> {
    const key = (buyerUserName ?? '').trim().toLowerCase();
    if (!key) return null;
    return this.prisma.user.findUnique({
      where: { userName: key },
      select: { id: true, userName: true, firstName: true, lastName: true },
    });
  }

  /** ردیف دفتر خریدار (لنگر ذخیره‌شده‌ها) — ناشناخته/ندارد → null */
  private async buyerBookRow(buyerUserName: string): Promise<{ id: string } | null> {
    const buyer = await this.findBuyer(buyerUserName);
    if (!buyer) return null;
    return this.prisma.userBuyerBook.findUnique({
      where: { userId: buyer.id },
      select: { id: true },
    });
  }

  /** کالاهای دفتر — نام دسته/مسیر + نوع کالا، عین getMyBook (فقط خواندنی) */
  private async mapItems(
    rows: Array<{
      categoryId: number;
      volumeMin: number;
      period: string;
      unit: string;
      goodId: number | null;
      status: string;
      rejectionReasons: string[];
    }>,
  ): Promise<BuyerBookItemDto[]> {
    const cats = await this.categoriesWithPath(rows.map((r) => r.categoryId));
    const goods = await this.goodNameMap(rows.map((r) => r.goodId));
    return rows.map((r) => {
      const cat = cats.get(r.categoryId);
      return {
        categoryId: r.categoryId,
        name: cat?.name ?? `دسته ${r.categoryId}`,
        rootName: cat?.rootName ?? '',
        parentName: cat?.parentName ?? '',
        unit: r.unit,
        minAmount: r.volumeMin,
        period: r.period,
        productType: r.goodId != null ? (goods.get(r.goodId) ?? null) : null,
        example: cat?.example ?? null,
        status: r.status as BuyerBookItemDto['status'],
        rejectionReasons: r.rejectionReasons ?? [],
      };
    });
  }

  /** نام دسته + مسیر (ریشه/پدر) و واحد بر اساس id — عین buyers.service
   *  (کپی برای استقلال ماژول؛ دو کوئری حداکثر + یک کوئری جدّها) */
  private async categoriesWithPath(ids: number[]) {
    if (ids.length === 0) {
      return new Map<number, { name: string; rootName: string; parentName: string; unit: string; example: string | null }>();
    }
    const uniq = [...new Set(ids)];
    const rows = await this.prisma.category.findMany({
      where: { id: { in: uniq } },
      select: { id: true, categoryName: true, parentId: true, unit: true, example: true },
    });
    const parentIds = [...new Set(rows.map((r) => r.parentId).filter((x): x is number => x != null))];
    const parents = parentIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: parentIds } },
          select: { id: true, categoryName: true, parentId: true },
        })
      : [];
    // جدّها (ریشهٔ درخت) — سطح سوم؛ بدون این کوئری rootName اشتباه می‌شد
    const grandIds = [...new Set(parents.map((p) => p.parentId).filter((x): x is number => x != null))];
    const grands = grandIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: grandIds } },
          select: { id: true, categoryName: true },
        })
      : [];
    const parentById = new Map(parents.map((p) => [p.id, p]));
    const grandById = new Map(grands.map((g) => [g.id, g]));
    const out = new Map<
      number,
      { name: string; rootName: string; parentName: string; unit: string; example: string | null }
    >();
    for (const r of rows) {
      const parent = r.parentId != null ? parentById.get(r.parentId) : undefined;
      const root = parent?.parentId != null ? grandById.get(parent.parentId) : undefined;
      out.set(r.id, {
        name: r.categoryName,
        unit: r.unit ?? 'کیلوگرم',
        parentName: parent?.categoryName ?? '',
        rootName: root?.categoryName ?? parent?.categoryName ?? '',
        example: r.example ?? null,
      });
    }
    return out;
  }

  /** نام نوع‌ها از id — یک کوئری؛ ورودی‌های null/خالی حذف می‌شوند */
  private async goodNameMap(goodIds: Array<number | null | undefined>): Promise<Map<number, string>> {
    const uniq = [...new Set(goodIds.filter((x): x is number => x != null))];
    if (uniq.length === 0) return new Map();
    const rows = await this.prisma.good.findMany({
      where: { id: { in: uniq } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((g) => [g.id, g.name]));
  }

  /** تازه‌ترین آواتار هر کاربر — الگوی کاتالوگ/علاقه‌مندی‌ها (اولین ردیف desc) */
  private async avatarMap(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const files = await this.prisma.file.findMany({
      where: { relatedModel: 'User', relatedId: { in: userIds }, fieldKey: 'avatar' },
      orderBy: { createdAt: 'desc' },
      select: { relatedId: true, url: true, thumbUrl: true },
    });
    const map = new Map<string, string>();
    for (const f of files) {
      if (f.relatedId && !map.has(f.relatedId)) map.set(f.relatedId, f.thumbUrl ?? f.url);
    }
    return map;
  }

  /** نام شهرها — join سبک با سرویس مکان‌ها (الگوی کاتالوگ) */
  private async cityNames(cityIds: Array<number | null>): Promise<Map<number, string>> {
    const ids = [...new Set(cityIds.filter((c): c is number => c != null))];
    if (ids.length === 0) return new Map();
    const names = await this.locations.getNames([], ids);
    return names.cities;
  }
}

/** ستون‌های تنظیمات که سرویس می‌خواند */
const BOOK_SELECT = {
  id: true,
  bookId: true,
  brandColor: true,
  logo: true,
} as const;

/** دیتای کاربر که حل تنظیمات نیاز دارد */
const USER_BRIEF_SELECT = {
  id: true,
  userName: true,
  firstName: true,
  lastName: true,
} as const;
