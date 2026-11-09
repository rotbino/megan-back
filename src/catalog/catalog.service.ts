import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';
import { LocationsService } from '../locations/locations.service';
import type { AuthUser } from '../common/guards';
import type { CreateCatalogDto, UpdateCatalogDto } from './dto';

/** قاعدهٔ آیدی پیج — قرینهٔ فرانت (lib/catalog.ts) و استاب سندباکس */
const PAGEID_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;
const PAGEID_HINT = 'آیدی پیج باید ۳ تا ۳۰ نویسه باشد: حروف لاتین کوچک، عدد و خط تیره.';
const PAGE_ID_TAKEN = 'این آیدی قبلاً گرفته شده است؛ آیدی دیگری انتخاب کنید.';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = '#0f766e'; // یشمی — متمایز از سرمه‌ای ایمچ
/** سقف ذخیره‌شده‌ها — هم‌قاعدهٔ علاقه‌مندی‌ها */
const SAVED_LIMIT = 200;
/** سقف لیست ذخیره‌کنندگان — فقط شمار دقیق است، لیست همین‌قدر */
const SAVERS_TAKE = 200;

/** قالب تاریخ باسکول — یکدست با بقیهٔ API */
const fmtDate = (d: Date | null | undefined): string =>
  d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : '';

/** نرمال‌سازی اینستاگرام — @ و آدرس کامل و اسلش آخر می‌کَند (قرینهٔ فرانت) */
function normalizeInstagram(v: string | null | undefined): string | null {
  const t = (v ?? '')
    .trim()
    .replace(/^@+/, '')
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '')
    .replace(/\/+$/, '');
  return t || null;
}

/** نرمال‌سازی واتساپ — ارقام فارسی/لاتینی؛ ۰۰۹۸/۹۸+/۹… → قالب 09xxxxxxxxx */
function normalizeWhatsapp(v: string | null | undefined): string | null {
  let d = (v ?? '')
    .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/\D/g, '');
  if (d.startsWith('0098')) d = d.slice(4);
  else if (d.startsWith('98') && d.length === 12) d = d.slice(2);
  if (/^9\d{9}$/.test(d)) d = `0${d}`;
  return /^09\d{9}$/.test(d) ? d : null;
}

/** DTO عمومی کاتالوگ — هم‌شکل UserCatalog فرانت (lib/types.ts) */
export interface UserCatalogDto {
  pageId: string;
  brandColor: string;
  instagramId: string | null;
  whatsappNumber: string | null;
  createdAt: string;
  updatedAt: string | null;
}

/** ردیف «کاتالوگهای ذخیره شده» پنل خریدار — دفترچهٔ تلفن */
export interface SavedCatalogRowDto {
  pageId: string;
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

/**
 * ─── کاتالوگ محصول (خواسته مالک ۱۰-۱۱) ──────────────────────────────────────
 *
 * صفحهٔ عمومی مستقل فروشنده: /catalog/{pageId} — محصولات و نظرات از همان
 * دیتای ایمچ می‌آیند (فرانت getSeller می‌زند)؛ این سرویس فقط تنظیمات پیج
 * (آیدی یکتا، رنگ برند، اینستاگرام/واتساپ) و دفترچهٔ ذخیرهٔ خریداران را
 * نگه می‌دارد. هر کاربر حداکثر یک کاتالوگ دارد (یک‌به‌یک با User).
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

  // ─── آیدی پیج ────────────────────────────────────────────────────────────

  /** POST /catalog/checkPageId — یکتایی آیدی (عمومی؛ بدون ورود).
   *  قالب نامعتبر هم available:false می‌دهد تا فرانت همان‌جا راهنمایی کند. */
  async checkPageId(raw: string): Promise<{ available: boolean }> {
    const pageId = (raw ?? '').trim().toLowerCase();
    if (!PAGEID_RE.test(pageId)) return { available: false };
    const taken = await this.prisma.userCatalog.findUnique({
      where: { pageId },
      select: { id: true },
    });
    return { available: !taken };
  }

  // ─── ساخت / ویرایش ───────────────────────────────────────────────────────

  /** POST /catalog/create — ساخت با آیدی یکتا + رنگ برند + تماس‌های اختیاری */
  async create(user: AuthUser, dto: CreateCatalogDto): Promise<UserCatalogDto> {
    const pageId = (dto.pageId ?? '').trim().toLowerCase();
    if (!PAGEID_RE.test(pageId)) throw AppError.badRequest(PAGEID_HINT, 'INVALID_PAGE_ID');

    const [mine, taken] = await Promise.all([
      this.prisma.userCatalog.findUnique({ where: { userId: user.id }, select: { id: true } }),
      this.prisma.userCatalog.findUnique({ where: { pageId }, select: { id: true } }),
    ]);
    if (mine) {
      throw AppError.conflict('شما قبلاً کاتالوگ ساخته‌اید؛ از همان ویرایش کنید.', 'CATALOG_EXISTS');
    }
    if (taken) throw AppError.conflict(PAGE_ID_TAKEN, 'PAGE_ID_TAKEN');

    const row = await this.prisma.userCatalog.create({
      data: {
        userId: user.id,
        pageId,
        brandColor: this.saneColor(dto.brandColor),
        instagramId: normalizeInstagram(dto.instagramId),
        whatsappNumber: this.saneWhatsapp(dto.whatsappNumber),
      },
    });
    await this.invalidateSellerCaches(user.id);
    return this.toDto(row);
  }

  /** POST /catalog/update — ویرایش آیدی/رنگ/تماس‌ها؛ آیدی جدید باید آزاد باشد */
  async update(user: AuthUser, dto: UpdateCatalogDto): Promise<UserCatalogDto> {
    const mine = await this.prisma.userCatalog.findUnique({ where: { userId: user.id } });
    if (!mine) throw AppError.notFound('کاتالوگی برای ویرایش پیدا نشد.');

    const pageId = dto.pageId != null ? dto.pageId.trim().toLowerCase() : mine.pageId;
    if (!PAGEID_RE.test(pageId)) throw AppError.badRequest(PAGEID_HINT, 'INVALID_PAGE_ID');
    if (pageId !== mine.pageId) {
      const taken = await this.prisma.userCatalog.findUnique({ where: { pageId }, select: { id: true } });
      if (taken) throw AppError.conflict(PAGE_ID_TAKEN, 'PAGE_ID_TAKEN');
    }

    const row = await this.prisma.userCatalog.update({
      where: { id: mine.id },
      data: {
        // فقط فیلدهای ارسال‌شده عوض می‌شوند — ویرایش جزئی هم مجاز است
        ...(pageId !== mine.pageId ? { pageId } : {}),
        ...(dto.brandColor !== undefined ? { brandColor: this.saneColor(dto.brandColor) } : {}),
        ...(dto.instagramId !== undefined ? { instagramId: normalizeInstagram(dto.instagramId) } : {}),
        ...(dto.whatsappNumber !== undefined ? { whatsappNumber: this.saneWhatsapp(dto.whatsappNumber) } : {}),
        updatedAt: new Date(),
      },
    });
    await this.invalidateSellerCaches(user.id);
    return this.toDto(row);
  }

  /** POST /catalog/getMine — تنظیمات کاتالوگ خودم (null = هنوز نساخته‌ام) */
  async getMine(userId: string): Promise<UserCatalogDto | null> {
    const row = await this.prisma.userCatalog.findUnique({ where: { userId } });
    return row ? this.toDto(row) : null;
  }

  // ─── صفحهٔ عمومی ─────────────────────────────────────────────────────────

  /** POST /catalog/getByPageId — SSR صفحهٔ عمومی (بدون ورود).
   *  null = پیج نیست یا صاحبش غیرفعال است (فرانت 404 می‌کند). */
  async getByPageId(pageId: string): Promise<{
    catalog: UserCatalogDto;
    userName: string;
    saversCount: number;
  } | null> {
    const row = await this.prisma.userCatalog.findUnique({
      where: { pageId: (pageId ?? '').trim().toLowerCase() },
      include: { user: { select: { userName: true, isActive: true } } },
    });
    if (!row || !row.user.isActive) return null;
    const saversCount = await this.prisma.savedCatalog.count({ where: { catalogId: row.id } });
    return { catalog: this.toDto(row), userName: row.user.userName, saversCount };
  }

  /** POST /catalog/getSavers — ذخیره‌کنندگان یک کاتالوگ (عمومی — لیست برای
   *  همه؛ تماس/چت فقط صاحب پیج، گیتش سمت فرانت است چون نیاز به مقایسهٔ
   *  «آیا بیننده صاحب کاتالوگ است» دارد). */
  async getSavers(pageId: string): Promise<{ count: number; items: CatalogSaverRowDto[] }> {
    const catalog = await this.prisma.userCatalog.findUnique({
      where: { pageId: (pageId ?? '').trim().toLowerCase() },
      select: { id: true },
    });
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

  // ─── دفترچهٔ ذخیرهٔ خریدار ────────────────────────────────────────────────

  /** POST /catalog/isSaved — وضعیت دکمهٔ ذخیره برای بینندهٔ واردشده */
  async isSaved(userId: string, pageId: string): Promise<{ saved: boolean }> {
    const catalog = await this.prisma.userCatalog.findUnique({
      where: { pageId: (pageId ?? '').trim().toLowerCase() },
      select: { id: true },
    });
    if (!catalog) return { saved: false };
    const row = await this.prisma.savedCatalog.findUnique({
      where: { userId_catalogId: { userId, catalogId: catalog.id } },
      select: { id: true },
    });
    return { saved: row != null };
  }

  /** POST /catalog/toggleSave — ذخیره/حذف ذخیرهٔ کاتالوگ (مثل favorites) */
  async toggleSave(user: AuthUser, pageId: string): Promise<{ saved: boolean }> {
    const catalog = await this.prisma.userCatalog.findUnique({
      where: { pageId: (pageId ?? '').trim().toLowerCase() },
      select: { id: true },
    });
    if (!catalog) throw AppError.notFound('کاتالوگ یافت نشد.');

    const existing = await this.prisma.savedCatalog.findUnique({
      where: { userId_catalogId: { userId: user.id, catalogId: catalog.id } },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.savedCatalog.delete({ where: { id: existing.id } });
      return { saved: false };
    }

    const count = await this.prisma.savedCatalog.count({ where: { userId: user.id } });
    if (count >= SAVED_LIMIT) {
      throw AppError.badRequest(
        `حداکثر ${SAVED_LIMIT} کاتالوگ قابل ذخیره است — ابتدا برخی را حذف کنید.`,
        'SAVED_CATALOGS_FULL',
      );
    }
    await this.prisma.savedCatalog.create({ data: { userId: user.id, catalogId: catalog.id } });
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
        catalog: { include: { user: { select: { id: true, userName: true, firstName: true, lastName: true, cityId: true, isActive: true } } } },
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
          pageId: r.catalog.pageId,
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

  // ─── خصوصی‌ها ────────────────────────────────────────────────────────────

  /** رنگ معتبر hex یا پیش‌فرض — فرانت پالت بسته دارد، این عقب‌گیری است */
  private saneColor(v: string | null | undefined): string {
    const t = (v ?? '').trim();
    return HEX_RE.test(t) ? t.toLowerCase() : DEFAULT_COLOR;
  }

  /** واتساپ معتبر یا خطا — برخلاف رنگ، مقدار خراب بی‌صدا نادیده گرفته نمی‌شود */
  private saneWhatsapp(v: string | null | undefined): string | null {
    if (v == null || !v.trim()) return null;
    const d = normalizeWhatsapp(v);
    if (!d) {
      throw AppError.badRequest('شماره واتساپ معتبر نیست — قالب درست: 09xxxxxxxxx', 'INVALID_WHATSAPP');
    }
    return d;
  }

  /** کشِ پروفایل فروشنده و کارت‌های آگهی بی‌اعتبار می‌شود — هر دو
   *  فیلد catalog صاحبشان را جواب می‌دهند و باید فوراً به‌روز دیده شوند */
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

  private toDto(row: { pageId: string; brandColor: string; instagramId: string | null; whatsappNumber: string | null; createdAt: Date; updatedAt: Date | null }): UserCatalogDto {
    return {
      pageId: row.pageId,
      brandColor: row.brandColor,
      instagramId: row.instagramId ?? null,
      whatsappNumber: row.whatsappNumber ?? null,
      createdAt: fmtDate(row.createdAt),
      // null تا اولین ویرایش — عین استاب/فرانت ('' نباشد)
      updatedAt: row.updatedAt ? fmtDate(row.updatedAt) : null,
    };
  }
}
