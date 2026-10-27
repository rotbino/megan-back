import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService, TTL } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';
import { CategoriesService } from '../categories/categories.service';
import { LocationsService } from '../locations/locations.service';
import { UploadsService } from '../uploads/uploads.service';
import { CallsService } from '../calls/calls.service';
import type { AuthUser } from '../common/guards';
import type { CreateProductDto, GetProductListDto } from './dto';

/** ظرفیت آگهی پلن رایگان باسکول */
export const PRODUCT_CAPACITY = 5;
const PER_PAGE_DEFAULT = 16;
const PRODUCT_START_ID = 3_000_000; // بالاتر از idهای باسکول — seed شمارنده را دقیق‌تر می‌گذارد

/** شکل عمومی DTO — camelCase منطبق تایپ‌های فرانت (types.ts) */
export interface ProductDto {
  id: number;
  productName: string;
  slug: string;
  description: string;
  stock: number;
  minSalePrice: number;
  minSaleAmount: number;
  unit: string;
  categoryId: number;
  categoryName: string;
  subCategoryId: number;
  subCategoryName: string;
  provinceId: number;
  provinceName: string;
  cityId: number;
  cityName: string;
  myuserId: string;
  seller: {
    id: string;
    userName: string;
    firstName: string;
    lastName: string;
    activePakageType: 0;
    isVerified: boolean;
  };
  isLadder: boolean;
  isElevated: boolean;
  hasVideo: boolean;
  isOld: boolean;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  photos: string[];
  photoThumbs: string[];
  status?: string;
  features?: Array<{ key: string; value: string }>;
  rejectionReasons?: string[];
}

/** قالب تاریخ باسکول: «YYYY-MM-DD HH:mm:ss» */
const fmtDate = (d: Date | null | undefined): string =>
  d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : '';

/**
 * نام‌های join‌شده برای نمایش — رکورد Product فقط شناسه دارد (رابطه یک‌به‌چند
 * User↔Product با user_id)؛ این نام‌ها در لحظه خواندن ساخته می‌شوند.
 */
interface NameMaps {
  users: Map<string, { userName: string; firstName: string; lastName: string; isVerified: boolean }>;
  cats: Map<number, string>;
  provs: Map<number, string>;
  cities: Map<number, string>;
}

const EMPTY_MAPS: NameMaps = {
  users: new Map(),
  cats: new Map(),
  provs: new Map(),
  cities: new Map(),
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly categories: CategoriesService,
    private readonly locations: LocationsService,
    private readonly uploads: UploadsService,
    private readonly calls: CallsService,
  ) {}

  // ─── لیست عمومی ────────────────────────────────────────────────────────────

  /**
   * POST /products/getProductList — فیلتر دسته (با فرزندان) + استان/شهر + جستجو؛
   * سورت «مرتبط‌ترین» = نردبان اول بعد جدیدترین (عین باسکول)؛ صفحه‌بندی.
   * کش ۳۰ثانیه‌ای با تگ products — هر ثبت/حذف/آپلود عکس بیاتش می‌کند.
   */
  async getProductList(dto: GetProductListDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? PER_PAGE_DEFAULT;
    const sort = dto.sort === 'newest' ? 'newest' : 'related';

    return this.cache.wrap(
      `products:list:${JSON.stringify(dto)}`,
      { ttlMs: TTL.SHORT, tags: ['products'] },
      async () => {
        const where: Prisma.ProductWhereInput = { status: 'confirmed', user: { isActive: true } };

        // فیلتر دسته — خودش + درخت فرزندان
        if (dto.categorySlug) {
          const ids = await this.categories.getSubtreeIds(dto.categorySlug);
          if (ids.length === 0) return { items: [], total: 0, page, pageCount: 0 };
          where.OR = [
            { subCategoryId: { in: ids } },
            { categoryId: { in: ids } },
          ];
        }

        // جستجو — نام محصول + نام دسته (resolve از درخت کش‌شده، بدون ستون denorm)
        const s = dto.s?.trim();
        if (s) {
          const catIds = await this.categories.searchCategoryIds(s);
          const textMatch: Prisma.ProductWhereInput[] = [
            { productName: { contains: s } },
            ...(catIds.length > 0
              ? [{ subCategoryId: { in: catIds } }, { categoryId: { in: catIds } }]
              : []),
          ];
          if (where.OR) {
            // دسته + جستجو همزمان → AND داخلی
            const catFilter = where.OR;
            where.AND = [{ OR: catFilter }, { OR: textMatch }];
            delete where.OR;
          } else {
            where.OR = textMatch;
          }
        }

        if (dto.provinceId) where.provinceId = dto.provinceId;
        if (dto.cityId) where.cityId = dto.cityId;

        // نردبان منقضی عملاً غیرفعال است — فیلتر زنده
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : []),
          { OR: [{ isLadder: false }, { ladderExpiresAt: { gt: new Date() } }] },
        ];

        const orderBy: Prisma.ProductOrderByWithRelationInput[] =
          sort === 'newest'
            ? [{ updatedAt: 'desc' }]
            : [{ isLadder: 'desc' }, { updatedAt: 'desc' }];

        const [total, rows] = await Promise.all([
          this.prisma.product.count({ where }),
          this.prisma.product.findMany({
            where,
            orderBy,
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
        ]);

        const pageCount = Math.max(1, Math.ceil(total / pageSize));
        const gallery = await this.uploads.galleryMap(rows.map((r) => r.id));
        const names = await this.hydrateNames(rows);
        return {
          items: rows.map((r) => this.toDto(r, gallery.get(r.id) ?? [], names)),
          total,
          page,
          pageCount,
        };
      },
    );
  }

  // ─── جزئیات ────────────────────────────────────────────────────────────────

  /** POST /products/getProductById — عمومی (confirmed)؛ بازدید فقط روی cache-miss */
  async getProductById(id: number) {
    return this.cache.wrap(
      `product:${id}`,
      { ttlMs: TTL.MINUTE, tags: ['products', `product:${id}`] },
      async () => {
        const p = await this.prisma.product.findFirst({
          where: { id, status: 'confirmed', user: { isActive: true } },
        });
        if (!p) {
          throw AppError.notFound('محصول یافت نشد.');
        }
        // شمارش بازدید — fire-and-forget؛ پاسخ با مقدار فعلی
        void this.prisma.product
          .update({ where: { id }, data: { viewCount: { increment: 1 } } })
          .catch(() => undefined);
        const gallery = await this.uploads.galleryMap([id]);
        const names = await this.hydrateNames([p]);
        return this.toDto(p, gallery.get(id) ?? [], names);
      },
    );
  }

  /** POST /products/getRelatedProducts — هم‌دسته (عین باسکول) */
  async getRelatedProducts(subCategoryId: number, excludeId: number, limit = 6) {
    const rows = await this.prisma.product.findMany({
      where: { subCategoryId, status: 'confirmed', id: { not: excludeId }, user: { isActive: true } },
      orderBy: [{ isLadder: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    });
    const [gallery, names] = await Promise.all([
      this.uploads.galleryMap(rows.map((r) => r.id)),
      this.hydrateNames(rows),
    ]);
    return rows.map((r) => this.toDto(r, gallery.get(r.id) ?? [], names));
  }

  // ─── ثبت (ویزارد) ──────────────────────────────────────────────────────────

  /** POST /products/createProduct — خروجی ویزارد ۶ مرحله‌ای → «در انتظار تایید» */
  async createProduct(user: AuthUser, dto: CreateProductDto) {
    // ظرفیت پلن رایگان (عین باسکول)
    const active = await this.prisma.product.count({
      where: { userId: user.id, status: { in: ['pending', 'confirmed'] } },
    });
    if (active >= PRODUCT_CAPACITY) {
      throw AppError.badRequest(
        'امکان ثبت محصول جدید را ندارید! ظرفیت پلن رایگان شما تکمیل شده است.',
        'CAPACITY_FULL',
      );
    }

    // اعتبارسنجی ارجاع‌ها — دسته/استان/شهر باید فعال باشند
    const sub = await this.categories.getCategoryById(dto.subCategoryId);
    if (!sub || sub.kind !== 'CATEGORY') {
      throw AppError.badRequest('دسته انتخابی معتبر نیست.', 'BAD_CATEGORY');
    }
    const city = await this.locations.getCityById(dto.cityId);
    if (!city) throw AppError.badRequest('شهر انتخابی معتبر نیست.', 'BAD_CITY');
    if (city.province_id !== dto.provinceId) {
      throw AppError.badRequest('شهر به استان انتخابی تعلق ندارد.', 'CITY_PROVINCE_MISMATCH');
    }
    if (city.is_active === false) {
      throw AppError.badRequest('شهر انتخابی فعلاً غیرفعال است.', 'INACTIVE_LOCATION');
    }
    const province = await this.locations.getProvinceById(dto.provinceId);
    if (!province) throw AppError.badRequest('استان انتخابی معتبر نیست.', 'BAD_PROVINCE');
    if (province.is_active === false) {
      throw AppError.badRequest('استان انتخابی فعلاً غیرفعال است.', 'INACTIVE_LOCATION');
    }

    const id = await this.nextProductId();
    const parent = sub.parent_id != null ? await this.categories.getCategoryById(sub.parent_id) : null;
    const categoryId = parent?.id ?? sub.id;

    // رکورد نرمال — فقط شناسه‌ها؛ نام‌ها هنگام خواندن join می‌شوند
    const product = await this.prisma.product.create({
      data: {
        id,
        productName: dto.productName.trim(),
        slug: `خرید-عمده-${dto.productName.trim()}-${id}`,
        description: dto.description.trim(),
        categoryId,
        subCategoryId: sub.id,
        unit: sub.unit || 'کیلوگرم', // اسنپ‌شات واحدِ آگهی (جزو داده خود آگهی)
        provinceId: province.id,
        cityId: city.id,
        stock: dto.stock,
        minSaleAmount: dto.minSaleAmount,
        minSalePrice: dto.minSalePrice,
        features: (dto.features ?? []) as unknown as object,
        status: 'pending',
        userId: user.id,
      },
    });

    this.cache.invalidateTag('products');
    return { id: product.id, status: product.status as string };
  }

  // ─── پنل ───────────────────────────────────────────────────────────────────

  /** POST /products/getMyProducts — آگهی‌های کاربر جاری + شمارنده تب‌ها + ظرفیت */
  async getMyProducts(userId: string) {
    const rows = await this.prisma.product.findMany({
      where: { userId, status: { not: 'deleted' } },
      orderBy: { updatedAt: 'desc' },
    });
    const counts: Record<string, number> = { confirmed: 0, pending: 0, rejected: 0, deleted: 0 };
    // ردیف‌های حذف‌شده هم برای تب «حذف شده» شمرده می‌شوند — یک کوئری دیگر
    const deletedCount = await this.prisma.product.count({ where: { userId, status: 'deleted' } });
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    counts.deleted = deletedCount;

    const [gallery, names] = await Promise.all([
      this.uploads.galleryMap(rows.map((r) => r.id)),
      this.hydrateNames(rows),
    ]);
    return {
      items: rows.map((r) => this.toDto(r, gallery.get(r.id) ?? [], names)),
      counts,
      capacity: PRODUCT_CAPACITY,
    };
  }


  /** POST /products/reviewProduct (ادمین) — تأیید/رد آگهی در انتظار تایید */
  async reviewProduct(dto: { id: number; approve: boolean; rejectionReasons?: string[] }) {
    const p = await this.prisma.product.findUnique({ where: { id: dto.id } });
    if (!p) throw AppError.notFound('محصول یافت نشد.');
    if (p.status !== 'pending') {
      throw AppError.conflict('این آگهی قبلاً بررسی شده است.', 'ALREADY_REVIEWED');
    }
    if (!dto.approve && (!dto.rejectionReasons || dto.rejectionReasons.length === 0)) {
      throw AppError.badRequest('دلیل (یا دلایل) رد شدن را وارد کنید.', 'REASON_REQUIRED');
    }
    const updated = await this.prisma.product.update({
      where: { id: dto.id },
      data: dto.approve
        ? { status: 'confirmed' }
        : { status: 'rejected', rejectionReasons: dto.rejectionReasons },
    });
    this.cache.invalidateTag('products');
    this.cache.invalidateTag(`product:${dto.id}`);
    return { id: updated.id, status: updated.status };
  }

  /** POST /products/deleteMyProduct — حذف نرم (تب «حذف شده» عین باسکول) */
  async deleteMyProduct(user: AuthUser, id: number) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p || p.userId !== user.id) throw AppError.notFound('محصول یافت نشد.');
    if (p.status === 'deleted') return { ok: true as const };

    await this.prisma.product.update({
      where: { id },
      data: { status: 'deleted', isLadder: false },
    });
    this.cache.invalidateTag('products');
    this.cache.invalidateTag(`product:${id}`);
    return { ok: true as const };
  }

  // ─── فروشنده عمومی ─────────────────────────────────────────────────────────

  /**
   * POST /products/getSellerPhone — شماره تماس فروشنده آگهی (مدل lead-gen):
   * عمومی است (مثل آشکارسازی قیمت باسکول)؛ اما اگر خریدار وارد شده باشد،
   * همان لحظه به‌عنوان «تماس» ثبت می‌شود تا ادمین بداند کی به کی زنگ زده.
   * خود فروشنده شماره خودش را می‌بیند بدون ثبت.
   */
  async getSellerPhone(caller: AuthUser | null, productId: number) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { userId: true, status: true },
    });
    if (!product || product.status !== 'confirmed') throw AppError.notFound('آگهی یافت نشد.');

    const seller = await this.prisma.user.findUnique({
      where: { id: product.userId },
      select: { id: true, phone: true, firstName: true, lastName: true, userName: true, isActive: true },
    });
    if (!seller || !seller.isActive) throw AppError.notFound('فروشنده یافت نشد.');

    // ثبت تماس — فقط برای خریدار واردشده و غیر از خود فروشنده؛ best-effort
    let callLogged = false;
    if (caller && caller.id !== seller.id) {
      try {
        await this.calls.reportCall(caller, { calleeId: seller.id, productId, source: 'product' });
        callLogged = true;
      } catch {
        /* ثبت تماس نباید نمایش شماره را خراب کند */
      }
    }

    return {
      sellerId: seller.id,
      phone: seller.phone,
      firstName: seller.firstName,
      lastName: seller.lastName,
      userName: seller.userName,
      callLogged,
    };
  }

  /** POST /products/getSeller — پروفایل کسب‌وکار + آگهی‌های تاییدشده */
  async getSeller(userName: string) {
    const seller = await this.prisma.user.findUnique({ where: { userName } });
    if (!seller || !seller.isActive) throw AppError.notFound('فروشنده یافت نشد.');

    const rows = await this.prisma.product.findMany({
      where: { userId: seller.id, status: 'confirmed' },
      orderBy: [{ isLadder: 'desc' }, { updatedAt: 'desc' }],
      take: 48,
    });
    const [gallery, names] = await Promise.all([
      this.uploads.galleryMap(rows.map((r) => r.id)),
      this.hydrateNames(rows),
    ]);

    const avatarFile = await this.prisma.file.findFirst({
      where: { relatedModel: 'User', relatedId: seller.id, fieldKey: 'avatar' },
      orderBy: { createdAt: 'desc' },
      select: { url: true, thumbUrl: true },
    });

    return {
      user: {
        id: seller.id,
        userName: seller.userName,
        firstName: seller.firstName,
        lastName: seller.lastName,
        activePakageType: 0,
        isVerified: seller.isVerified,
        businessDesc: seller.businessDesc ?? null,
        avatarUrl: avatarFile?.thumbUrl ?? avatarFile?.url ?? null,
        createdAt: fmtDate(seller.createdAt),
      },
      products: rows.map((r) => this.toDto(r, gallery.get(r.id) ?? [], names)),
    };
  }

  // ─── جستجو ──────────────────────────────────────────────────────────────────

  /** POST /products/searchSuggestions — پیشنهاد زنده هدر (مثل باسکول) */
  async searchSuggestions(typedText: string): Promise<string[]> {
    const q = typedText.trim();
    if (!q) return [];

    // دسته‌ها از کش + نام محصولات (پرمخاطب‌ترین‌ها)
    const [cats, prods] = await Promise.all([
      this.categories.getAllCategories(), // کش‌شده
      this.prisma.product.findMany({
        where: { status: 'confirmed', productName: { contains: q }, user: { isActive: true } },
        select: { productName: true, viewCount: true },
        orderBy: { viewCount: 'desc' },
        take: 8,
      }),
    ]);

    const out = new Set<string>();
    const walk = (nodes: Array<{ category_name: string; children: unknown }>): void => {
      for (const n of nodes) {
        if (n.category_name.includes(q)) out.add(n.category_name);
        walk(n.children as Array<{ category_name: string; children: unknown }>);
      }
    };
    walk(cats as unknown as Array<{ category_name: string; children: unknown }>);
    for (const p of prods) out.add(`قیمت ${p.productName}`);
    return [...out].slice(0, 6);
  }

  // ─── داخلی ──────────────────────────────────────────────────────────────────

  /** id عددی افزایشی — increment اتمیک روی جدول Counter */
  private async nextProductId(): Promise<number> {
    const counter = await this.prisma.counter.upsert({
      where: { id: 'product' },
      create: { id: 'product', seq: PRODUCT_START_ID },
      update: { seq: { increment: 1 } },
    });
    return counter.seq;
  }

  /**
   * join نام‌ها برای نمایش — سه کوئری دسته‌ای (کاربران/لوکیشن‌ها + درخت کش‌شده دسته‌ها).
   * چون خروجی لیست/جزئیات کش می‌شود، این join فقط روی cache-miss اجرا می‌شود.
   */
  private async hydrateNames(rows: Array<{ userId: string; categoryId: number; subCategoryId: number; provinceId: number; cityId: number }>): Promise<NameMaps> {
    if (rows.length === 0) return EMPTY_MAPS;

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const provinceIds = [...new Set(rows.map((r) => r.provinceId))];
    const cityIds = [...new Set(rows.map((r) => r.cityId))];
    const catIds = [...new Set(rows.flatMap((r) => [r.categoryId, r.subCategoryId]))];

    const [userRows, catMap, locNames] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, userName: true, firstName: true, lastName: true, isVerified: true },
      }),
      this.categories.getNameMap(), // کش‌شده
      this.locations.getNames(provinceIds, cityIds),
    ]);

    const users = new Map(
      userRows.map((u) => [
        u.id,
        { userName: u.userName, firstName: u.firstName, lastName: u.lastName, isVerified: u.isVerified },
      ]),
    );
    const cats = new Map<number, string>();
    for (const id of catIds) cats.set(id, catMap.get(id)?.category_name ?? '—');

    return { users, cats, provs: locNames.provinces, cities: locNames.cities };
  }

  /** نگاشت ردیف DB → DTO فرانت (camelCase) + عکس‌ها از جدول File + نام‌های join‌شده */
  private toDto(
    p: {
      id: number;
      productName: string;
      slug: string;
      description: string;
      stock: number;
      minSalePrice: number;
      minSaleAmount: number;
      unit: string;
      categoryId: number;
      subCategoryId: number;
      provinceId: number;
      cityId: number;
      userId: string;
      isLadder: boolean;
      hasVideo: boolean;
      isOld: boolean;
      viewCount: number;
      status: string;
      features: unknown;
      rejectionReasons: unknown;
      createdAt: Date;
      updatedAt: Date;
    },
    gallery: Array<{ url: string; thumbUrl: string | null }>,
    names: NameMaps,
  ): ProductDto {
    const photos = gallery.map((f) => f.url);
    const photoThumbs = gallery.map((f) => f.thumbUrl ?? f.url);
    const features = Array.isArray(p.features)
      ? (p.features as Array<{ key: string; value: string }>)
      : [];
    const rejectionReasons = Array.isArray(p.rejectionReasons)
      ? (p.rejectionReasons as string[])
      : [];
    const seller = names.users.get(p.userId);
    const UNKNOWN = '—';

    return {
      id: p.id,
      productName: p.productName,
      slug: p.slug,
      description: p.description,
      stock: p.stock,
      minSalePrice: p.minSalePrice,
      minSaleAmount: p.minSaleAmount,
      unit: p.unit,
      categoryId: p.categoryId,
      categoryName: names.cats.get(p.categoryId) ?? UNKNOWN,
      subCategoryId: p.subCategoryId,
      subCategoryName: names.cats.get(p.subCategoryId) ?? UNKNOWN,
      provinceId: p.provinceId,
      provinceName: names.provs.get(p.provinceId) ?? UNKNOWN,
      cityId: p.cityId,
      cityName: names.cities.get(p.cityId) ?? UNKNOWN,
      myuserId: p.userId,
      seller: {
        id: p.userId,
        userName: seller?.userName ?? UNKNOWN,
        firstName: seller?.firstName ?? UNKNOWN,
        lastName: seller?.lastName ?? UNKNOWN,
        activePakageType: 0,
        isVerified: seller?.isVerified ?? false,
      },
      isLadder: p.isLadder,
      isElevated: false, // بدون فروشنده ویژه در ایمچ
      hasVideo: p.hasVideo,
      isOld: p.isOld,
      viewCount: p.viewCount,
      createdAt: fmtDate(p.createdAt),
      updatedAt: fmtDate(p.updatedAt),
      photos,
      photoThumbs,
      ...(p.status !== 'confirmed'
        ? { status: p.status, features, rejectionReasons }
        : {}),
      ...(p.status === 'confirmed' ? { features } : {}),
    };
  }
}
