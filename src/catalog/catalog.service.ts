import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';
import { LocationsService } from '../locations/locations.service';
import type { UpdateSettingsDto } from './dto';

/** قاعدهٔ آیدی سفارشی کاتالوگ — عین استاب سندباکس و فرانت (مودال تنظیمات) */
const CATALOGID_RE = /^[a-z0-9-]{3,30}$/;
const CATALOGID_HINT = 'آیدی کاتالوگ باید ۳ تا ۳۰ نویسه باشد؛ فقط حروف کوچک لاتین، رقم و خط تیره (-).';
const CATALOGID_TAKEN = 'این آیدی قبلاً گرفته شده است؛ یکی دیگر انتخاب کنید.';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const BRAND_NAME_MAX = 40;
const ICON_RE = /^[a-z0-9-]{2,30}$/;
/** سقف ذخیره‌شده‌ها — هم‌قاعدهٔ علاقه‌مندی‌ها */
const SAVED_LIMIT = 200;
/** سقف لیست ذخیره‌کنندگان — فقط شمار دقیق است، لیست همین‌قدر */
const SAVERS_TAKE = 200;

/** قالب تاریخ باسکول — یکدست با بقیهٔ API */
const fmtDate = (d: Date | null | undefined): string =>
  d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : '';

/** تنظیمات کاتالوگِ حل‌شده — هم‌شکل CatalogSettings فرانت (lib/types.ts) و
 *  استاب سندباکس؛ مقدار null = پیش‌فرض ایمچ (رنگ/آیکون) */
export interface CatalogSettingsDto {
  /** بخش آخر لینک عمومی — پیش‌فرض userName فروشنده */
  catalogId: string;
  /** نام برند — پیش‌فرض نام کامل فروشنده */
  brandName: string | null;
  /** رنگ برند hex — null = رنگ پیش‌فرض ایمچ */
  brandColor: string | null;
  /** کلید آیکون — پیش‌فرض 'store' */
  brandIcon: string;
}

/** ردیف «کاتالوگهای ذخیره شده» پنل خریدار — دفترچهٔ تلفن */
export interface SavedCatalogRowDto {
  sellerUserName: string;
  sellerId: string;
  sellerName: string;
  avatarUrl: string | null;
  cityName: string | null;
  productCount: number;
  savedAt: string;
}

/** ردیف ذخیره‌کنندهٔ کاتالوگ — باکس «ذخیره کنندگان» صفحهٔ عمومی */
export interface CatalogSaverRowDto {
  id: string;
  userName: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  cityName: string | null;
  savedAt: string;
}

/** حداقل دیتای کاربر که حل تنظیمات نیاز دارد */
interface UserBrief {
  id: string;
  userName: string;
  firstName: string;
  lastName: string;
}

/** ردیف UserCatalog — همهٔ فیلدها اختیاری (ردیف = انحراف از پیش‌فرض) */
interface CatalogRow {
  catalogId: string | null;
  brandName: string | null;
  brandColor: string | null;
  brandIcon: string | null;
}

/**
 * ─── کاتالوگ کاربر (خواسته مالک ۱۰-۱۱ + بازنگری دور ۲/۳) ──────────────────
 *
 * کاتالوگ فروشنده همان صفحهٔ عمومی اوست (/c/{catalogId}) — صفحهٔ مستقل
 * جداگانه‌ای وجود ندارد و «ساختن کاتالوگ» هم ندارد؛ با ثبت اولین محصول،
 * کاتالوگ خودبه‌خود هست. این سرویس فقط شخصی‌سازی (آیدی لینک، نام برند،
 * رنگ، آیکون) و دفترچهٔ ذخیرهٔ خریداران را نگه می‌دارد؛ کلید همه‌جا
 * userName فروشنده است.
 *
 * قرارداد کامل و دادهٔ نمونه در استاب سندباکس (megan-web/scripts/stub-backend.mjs)
 * مستند است — پیام‌های خطا عیناً همان‌ها هستند تا UX فرانت یکدست بماند.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly locations: LocationsService,
  ) {}

  // ─── شخصی‌سازی (پنل → مودال تنظیمات کاتالوگ) ──────────────────────────

  /** POST /catalog/getMySettings — تنظیمات خودم؛ همیشه پر با پیش‌فرض‌ها
   *  (ردیف نداشتن = همه‌چیز پیش‌فرض: آیدی userName، برند نام کامل، …). */
  async getMySettings(userId: string): Promise<{ settings: CatalogSettingsDto }> {
    const [user, row] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, userName: true, firstName: true, lastName: true },
      }),
      this.prisma.userCatalog.findUnique({
        where: { userId },
        select: CATALOG_SELECT,
      }),
    ]);
    if (!user) throw AppError.notFound('کاربر یافت نشد.');
    return { settings: this.resolvedSettings(user, row) };
  }

  /** POST /catalog/updateSettings — ذخیرهٔ تنظیمات؛ فقط فیلدهای ارسالی
   *  عوض می‌شوند. خطای ۴۰۰ (قالب) و ۴۰۹ (آیدی تکراری) با پیام فارسی —
   *  عین استاب؛ فرانت همان پیام را در مودال نشان می‌دهد. */
  async updateSettings(userId: string, dto: UpdateSettingsDto): Promise<{ settings: CatalogSettingsDto }> {
    const [user, existing] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, userName: true, firstName: true, lastName: true },
      }),
      this.prisma.userCatalog.findUnique({ where: { userId }, select: CATALOG_SELECT }),
    ]);
    if (!user) throw AppError.notFound('کاربر یافت نشد.');

    /** تغییرات مرحله‌ای — فقط بعد از عبور همهٔ ولیدیشن‌ها نوشته می‌شود */
    const patch: Partial<CatalogRow> = {};

    if (dto.catalogId !== undefined) {
      const id = String(dto.catalogId ?? '').trim().toLowerCase();
      if (!CATALOGID_RE.test(id)) throw AppError.badRequest(CATALOGID_HINT, 'INVALID_CATALOG_ID');
      if (id !== user.userName) {
        const owner = await this.catalogIdOwner(id, user.id);
        if (owner) throw AppError.conflict(CATALOGID_TAKEN, 'CATALOG_ID_TAKEN');
        patch.catalogId = id;
      } else {
        // آیدیِ برابر userName خودم = پیش‌فرض — ذخیره نمی‌شود
        patch.catalogId = null;
      }
    }
    if (dto.brandName !== undefined) {
      const bn = String(dto.brandName ?? '').trim();
      if (bn.length > BRAND_NAME_MAX) {
        throw AppError.badRequest('نام برند حداکثر ۴۰ نویسه است.', 'INVALID_BRAND_NAME');
      }
      patch.brandName = bn || null;
    }
    if (dto.brandColor !== undefined) {
      const bc = String(dto.brandColor ?? '').trim();
      if (bc && !HEX_RE.test(bc)) {
        throw AppError.badRequest('رنگ برند نامعتبر است (مثال: #0e9f6e).', 'INVALID_BRAND_COLOR');
      }
      patch.brandColor = bc ? bc.toLowerCase() : null;
    }
    if (dto.brandIcon !== undefined) {
      const bi = String(dto.brandIcon ?? '').trim();
      if (bi && !ICON_RE.test(bi)) {
        throw AppError.badRequest('آیکون انتخابی شناخته نشد.', 'INVALID_BRAND_ICON');
      }
      patch.brandIcon = bi || null;
    }

    const row = existing
      ? await this.prisma.userCatalog.update({
          where: { userId },
          data: { ...patch, updatedAt: new Date() },
          select: CATALOG_SELECT,
        })
      : await this.prisma.userCatalog.create({
          // ردیف اول فقط برای انحراف‌های واقعی ساخته می‌شود — پچ خالی =
          // همه‌چیز پیش‌فرض است و ردیفی لازم نیست
          data: Object.keys(patch).length ? { userId, ...patch } : { userId },
          select: CATALOG_SELECT,
        });

    await this.invalidateSellerCaches(userId);
    return { settings: this.resolvedSettings(user, row) };
  }

  // ─── صفحهٔ عمومی /c/{id} (SSR — بدون ورود) ────────────────────────────

  /** POST /catalog/resolvePublicId — رزولو آیدی عمومی؛ id می‌تواند آیدی
   *  سفارشی یا userName فروشنده باشد. null = ناشناخته (فرانت ۴۰۴ می‌کند).
   *  کاربر غیرفعال عملاً کاتالوگ ندارد → null (عین getSeller). */
  async resolvePublicId(raw: string): Promise<{ userName: string; settings: CatalogSettingsDto } | null> {
    const id = (raw ?? '').trim().toLowerCase();
    if (!id) return null;

    // ۱) آیدی سفارشی کسی؟ (کاربر غیرفعال عملاً کاتالوگ ندارد → رد می‌شود)
    const byCustom = await this.prisma.userCatalog.findFirst({
      where: { catalogId: id },
      select: { ...CATALOG_SELECT, user: { select: { ...USER_BRIEF_SELECT, isActive: true } } },
    });
    if (byCustom?.user.isActive) {
      const { user, ...row } = byCustom;
      return { userName: user.userName, settings: this.resolvedSettings(user, row) };
    }

    // ۲) خودِ userName فروشنده؟ (تنظیمات احتمالی‌اش هم همراهش می‌آید)
    const user = await this.prisma.user.findUnique({
      where: { userName: id },
      select: { ...USER_BRIEF_SELECT, isActive: true },
    });
    if (!user?.isActive) return null;
    const row = await this.prisma.userCatalog.findUnique({
      where: { userId: user.id },
      select: CATALOG_SELECT,
    });
    return { userName: user.userName, settings: this.resolvedSettings(user, row) };
  }

  // ─── دفترچهٔ ذخیرهٔ خریدار ─────────────────────────────────────────────

  /** POST /catalog/isSaved — وضعیت دکمهٔ ذخیره برای بینندهٔ واردشده.
   *  فروشندهٔ ناشناخته/بدون ردیف → false (بدون خطا — فرانت بی‌صدا تحمل می‌کند). */
  async isSaved(userId: string, sellerUserName: string): Promise<{ saved: boolean }> {
    const catalog = await this.sellerCatalogRow(sellerUserName);
    if (!catalog) return { saved: false };
    const row = await this.prisma.savedCatalog.findUnique({
      where: { userId_catalogId: { userId, catalogId: catalog.id } },
      select: { id: true },
    });
    return { saved: row != null };
  }

  /** POST /catalog/toggleSave — ذخیره/حذف ذخیرهٔ کاتالوگ (مثل favorites).
   *  کاتالوگِ فروشنده‌ای که هنوز ردیف تنظیمات ندارد لنگرِ ذخیره‌شده‌ها را
   *  ندارد → همان‌جا یک ردیف لخت (همه پیش‌فرض) برایش ساخته می‌شود؛ برای
   *  بیننده هیچ تفاوتی ندارد چون حل تنظیمات همان پیش‌فرض می‌ماند. */
  async toggleSave(userId: string, sellerUserName: string): Promise<{ saved: boolean }> {
    const seller = await this.findSeller(sellerUserName);
    if (!seller) throw AppError.notFound('کاتالوگ یافت نشد.');
    const catalog =
      (await this.prisma.userCatalog.findUnique({
        where: { userId: seller.id },
        select: { id: true },
      })) ??
      (await this.prisma.userCatalog.create({ data: { userId: seller.id }, select: { id: true } }));

    const existing = await this.prisma.savedCatalog.findUnique({
      where: { userId_catalogId: { userId, catalogId: catalog.id } },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.savedCatalog.delete({ where: { id: existing.id } });
      return { saved: false };
    }

    const count = await this.prisma.savedCatalog.count({ where: { userId } });
    if (count >= SAVED_LIMIT) {
      throw AppError.badRequest(
        `حداکثر ${SAVED_LIMIT} کاتالوگ قابل ذخیره است — ابتدا برخی را حذف کنید.`,
        'SAVED_CATALOGS_FULL',
      );
    }
    await this.prisma.savedCatalog.create({ data: { userId, catalogId: catalog.id } });
    return { saved: true };
  }

  /** POST /catalog/getMySaved — «کاتالوگهای ذخیره شده» پنل خریدار:
   *  دفترچهٔ تلفن با مشاهده/تماس/چت — کارت سبک مثل علاقه‌مندی‌های فروشنده. */
  async getMySaved(userId: string): Promise<{ items: SavedCatalogRowDto[] }> {
    const rows = await this.prisma.savedCatalog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: SAVED_LIMIT,
      include: {
        catalog: {
          include: {
            user: { select: { id: true, userName: true, firstName: true, lastName: true, cityId: true, isActive: true } },
          },
        },
      },
    });

    // فروشندهٔ غیرفعال = کاتالوگ عملاً مرده — از دفترچه می‌افتد
    const alive = rows.filter((r) => r.catalog.user.isActive);
    const sellerIds = [...new Set(alive.map((r) => r.catalog.user.id))];

    const [avatarMap, cityNames, countRows] = await Promise.all([
      this.avatarMap(sellerIds),
      this.cityNames(alive.map((r) => r.catalog.user.cityId)),
      sellerIds.length
        ? this.prisma.product.groupBy({
            by: ['userId'],
            where: { userId: { in: sellerIds }, status: 'confirmed' },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);
    const countMap = new Map(countRows.map((c) => [c.userId, c._count._all]));

    return {
      items: alive.map((r) => {
        const s = r.catalog.user;
        return {
          sellerUserName: s.userName,
          sellerId: s.id,
          sellerName: `${s.firstName} ${s.lastName}`.trim(),
          avatarUrl: avatarMap.get(s.id) ?? null,
          cityName: s.cityId != null ? (cityNames.get(s.cityId) ?? null) : null,
          productCount: countMap.get(s.id) ?? 0,
          savedAt: fmtDate(r.createdAt),
        };
      }),
    };
  }

  /** POST /catalog/getSavers — ذخیره‌کنندگان یک کاتالوگ (عمومی — لیست برای
   *  همه؛ تماس/چت فقط صاحب کاتالوگ، گیتش سمت فرانت است چون نیاز به مقایسهٔ
   *  «آیا بیننده صاحب کاتالوگ است» دارد). */
  async getSavers(sellerUserName: string): Promise<{ count: number; items: CatalogSaverRowDto[] }> {
    const catalog = await this.sellerCatalogRow(sellerUserName);
    if (!catalog) return { count: 0, items: [] };

    const [count, rows] = await Promise.all([
      this.prisma.savedCatalog.count({ where: { catalogId: catalog.id } }),
      this.prisma.savedCatalog.findMany({
        where: { catalogId: catalog.id },
        orderBy: { createdAt: 'desc' },
        take: SAVERS_TAKE,
        include: { user: { select: { id: true, userName: true, firstName: true, lastName: true, cityId: true } } },
      }),
    ]);

    const saverIds = rows.map((r) => r.user.id);
    const [avatarMap, cityNames] = await Promise.all([
      this.avatarMap(saverIds),
      this.cityNames(rows.map((r) => r.user.cityId)),
    ]);

    return {
      count,
      items: rows.map((r) => ({
        id: r.user.id,
        userName: r.user.userName,
        firstName: r.user.firstName,
        lastName: r.user.lastName,
        avatarUrl: avatarMap.get(r.user.id) ?? null,
        cityName: r.user.cityId != null ? (cityNames.get(r.user.cityId) ?? null) : null,
        savedAt: fmtDate(r.createdAt),
      })),
    };
  }

  // ─── خصوصی‌ها ────────────────────────────────────────────────────────

  /** حل تنظیمات — مقادیر ذخیره‌شده روی پیش‌فرض‌ها می‌نشینند (عین استاب):
   *  آیدی = userName، برند = نام کامل، رنگ = null (ایمچ)، آیکون = store. */
  private resolvedSettings(user: UserBrief, row: CatalogRow | null): CatalogSettingsDto {
    return {
      catalogId: row?.catalogId ?? user.userName,
      brandName: row?.brandName ?? `${user.firstName} ${user.lastName}`.trim(),
      brandColor: row?.brandColor ?? null,
      brandIcon: row?.brandIcon ?? 'store',
    };
  }

  /** آیدی عمومی آزاد است؟ — تداخل با آیدی سفارشی دیگران و userName هیچ
   *  کاربری (جز خودِ مالک) ممنوع. خروجی: null (آزاد) یا id تصاحب‌کننده. */
  private async catalogIdOwner(id: string, exceptUserId: string): Promise<string | null> {
    const taken = await this.prisma.userCatalog.findFirst({
      where: { catalogId: id, userId: { not: exceptUserId } },
      select: { userId: true },
    });
    if (taken) return taken.userId;
    const user = await this.prisma.user.findUnique({ where: { userName: id }, select: { id: true } });
    return user && user.id !== exceptUserId ? user.id : null;
  }

  /** فروشندهٔ ناشناخته → null؛ بریدن کلید یکسان با استاب (trim + lower) */
  private async findSeller(sellerUserName: string): Promise<UserBrief | null> {
    const key = (sellerUserName ?? '').trim().toLowerCase();
    if (!key) return null;
    return this.prisma.user.findUnique({
      where: { userName: key },
      select: { id: true, userName: true, firstName: true, lastName: true },
    });
  }

  /** ردیف کاتالوگ فروشنده (لنگر ذخیره‌شده‌ها) — ناشناخته/ندارد → null */
  private async sellerCatalogRow(sellerUserName: string): Promise<{ id: string } | null> {
    const seller = await this.findSeller(sellerUserName);
    if (!seller) return null;
    return this.prisma.userCatalog.findUnique({
      where: { userId: seller.id },
      select: { id: true },
    });
  }

  /** کشِ پروفایل فروشنده و کارت‌های آگهی بی‌اعتبار می‌شود — شخصی‌سازی
   *  (رنگ/نام برند) در صفحهٔ عمومی دیده می‌شود و باید فوراً به‌روز باشد */
  private async invalidateSellerCaches(userId: string): Promise<void> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { userName: true } });
    if (u?.userName) this.cache.invalidateTag(`seller:${u.userName.trim()}`);
    this.cache.invalidateTag('products');
  }

  /** تازه‌ترین آواتار هر کاربر — الگوی favorites (اولین ردیف desc) */
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

  /** نام شهرها — join سبک با سرویس مکان‌ها */
  private async cityNames(cityIds: Array<number | null>): Promise<Map<number, string>> {
    const ids = [...new Set(cityIds.filter((c): c is number => c != null))];
    if (ids.length === 0) return new Map();
    const names = await this.locations.getNames([], ids);
    return names.cities;
  }
}

/** ستون‌های تنظیمات که سرویس می‌خواند */
const CATALOG_SELECT = {
  catalogId: true,
  brandName: true,
  brandColor: true,
  brandIcon: true,
} as const;

/** دیتای کاربر که حل تنظیمات نیاز دارد */
const USER_BRIEF_SELECT = {
  id: true,
  userName: true,
  firstName: true,
  lastName: true,
} as const;
