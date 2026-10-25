import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService, TTL } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';
import { CategoriesService } from '../categories/categories.service';
import { LocationsService } from '../locations/locations.service';
import { UploadsService } from '../uploads/uploads.service';
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

type ProductRow = {
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
  userId: string;
  sellerUserName: string;
  sellerFirstName: string;
  sellerLastName: string;
  sellerIsVerified: boolean;
  isLadder: boolean;
  hasVideo: boolean;
  isOld: boolean;
  viewCount: number;
  status: string;
  features: unknown;
  rejectionReasons: unknown;
  createdAt: Date;
  updatedAt: Date;
  ladderExpiresAt: Date | null;
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly categories: CategoriesService,
    private readonly locations: LocationsService,
    private readonly uploads: UploadsService,
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
        const where: Prisma.ProductWhereInput = { status: 'confirmed' };

        // فیلتر دسته — خودش + درخت فرزندان
        if (dto.categorySlug) {
          const ids = await this.categories.getSubtreeIds(dto.categorySlug);
          if (ids.length === 0) return { items: [], total: 0, page, pageCount: 0 };
          where.OR = [
            { subCategoryId: { in: ids } },
            { categoryId: { in: ids } },
          ];
        }

        // جستجو — روی نام محصول و نام دسته (مثل باسکول)؛ فارسی case ندارد
        const s = dto.s?.trim();
        if (s) {
          const textMatch = [
            { productName: { contains: s } },
            { subCategoryName: { contains: s } },
            { categoryName: { contains: s } },
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
        return {
          items: rows.map((r) => this.toDto(r, gallery.get(r.id) ?? [])),
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
        const p = await this.prisma.product.findUnique({ where: { id } });
        if (!p || p.status !== 'confirmed') {
          throw AppError.notFound('محصول یافت نشد.');
        }
        // شمارش بازدید — fire-and-forget؛ پاسخ با مقدار فعلی
        void this.prisma.product
          .update({ where: { id }, data: { viewCount: { increment: 1 } } })
          .catch(() => undefined);
        const gallery = await this.uploads.galleryMap([id]);
        return this.toDto(p, gallery.get(id) ?? []);
      },
    );
  }

  /** POST /products/getRelatedProducts — هم‌دسته (عین باسکول) */
  async getRelatedProducts(subCategoryId: number, excludeId: number, limit = 6) {
    const rows = await this.prisma.product.findMany({
      where: { subCategoryId, status: 'confirmed', id: { not: excludeId } },
      orderBy: [{ isLadder: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    });
    const gallery = await this.uploads.galleryMap(rows.map((r) => r.id));
    return rows.map((r) => this.toDto(r, gallery.get(r.id) ?? []));
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

    // denorm از کش — بدون join
    const sub = await this.categories.getCategoryById(dto.subCategoryId);
    if (!sub || sub.kind !== 'CATEGORY') {
      throw AppError.badRequest('دسته انتخابی معتبر نیست.', 'BAD_CATEGORY');
    }
    const city = await this.locations.getCityById(dto.cityId);
    if (!city) throw AppError.badRequest('شهر انتخابی معتبر نیست.', 'BAD_CITY');
    if (city.province_id !== dto.provinceId) {
      throw AppError.badRequest('شهر به استان انتخابی تعلق ندارد.', 'CITY_PROVINCE_MISMATCH');
    }
    const province = await this.locations.getProvinceById(dto.provinceId);
    if (!province) throw AppError.badRequest('استان انتخابی معتبر نیست.', 'BAD_PROVINCE');

    const userRow = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, userName: true, firstName: true, lastName: true, isVerified: true },
    });
    if (!userRow) throw AppError.notFound('کاربر یافت نشد.');

    const id = await this.nextProductId();
    const parent = sub.parent_id != null ? await this.categories.getCategoryById(sub.parent_id) : null;
    const categoryId = parent?.id ?? sub.id;
    const categoryName = parent?.category_name ?? sub.category_name;

    const product = await this.prisma.product.create({
      data: {
        id,
        productName: dto.productName.trim(),
        slug: `خرید-عمده-${dto.productName.trim()}-${id}`,
        description: dto.description.trim(),
        categoryId,
        categoryName,
        subCategoryId: sub.id,
        subCategoryName: sub.category_name,
        unit: sub.unit || 'کیلوگرم',
        provinceId: province.id,
        provinceName: province.province_name,
        cityId: city.id,
        cityName: city.city_name,
        stock: dto.stock,
        minSaleAmount: dto.minSaleAmount,
        minSalePrice: dto.minSalePrice,
        features: (dto.features ?? []) as unknown as object,
        status: 'pending',
        userId: user.id,
        sellerUserName: userRow.userName,
        sellerFirstName: userRow.firstName,
        sellerLastName: userRow.lastName,
        sellerIsVerified: userRow.isVerified,
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

    const gallery = await this.uploads.galleryMap(rows.map((r) => r.id));
    return {
      items: rows.map((r) => this.toDto(r, gallery.get(r.id) ?? [])),
      counts,
      capacity: PRODUCT_CAPACITY,
    };
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

  /** POST /products/getSeller — پروفایل کسب‌وکار + آگهی‌های تاییدشده */
  async getSeller(userName: string) {
    const seller = await this.prisma.user.findUnique({ where: { userName } });
    if (!seller) throw AppError.notFound('فروشنده یافت نشد.');

    const rows = await this.prisma.product.findMany({
      where: { userId: seller.id, status: 'confirmed' },
      orderBy: [{ isLadder: 'desc' }, { updatedAt: 'desc' }],
      take: 48,
    });
    const gallery = await this.uploads.galleryMap(rows.map((r) => r.id));

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
      products: rows.map((r) => this.toDto(r, gallery.get(r.id) ?? [])),
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
        where: { status: 'confirmed', productName: { contains: q } },
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

  /** نگاشت ردیف DB → DTO فرانت (camelCase) + عکس‌ها از جدول File */
  private toDto(
    p: ProductRow,
    gallery: Array<{ url: string; thumbUrl: string | null }>,
  ): ProductDto {
    const photos = gallery.map((f) => f.url);
    const photoThumbs = gallery.map((f) => f.thumbUrl ?? f.url);
    const features = Array.isArray(p.features)
      ? (p.features as Array<{ key: string; value: string }>)
      : [];
    const rejectionReasons = Array.isArray(p.rejectionReasons)
      ? (p.rejectionReasons as string[])
      : [];

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
      categoryName: p.categoryName,
      subCategoryId: p.subCategoryId,
      subCategoryName: p.subCategoryName,
      provinceId: p.provinceId,
      provinceName: p.provinceName,
      cityId: p.cityId,
      cityName: p.cityName,
      myuserId: p.userId,
      seller: {
        id: p.userId,
        userName: p.sellerUserName,
        firstName: p.sellerFirstName,
        lastName: p.sellerLastName,
        activePakageType: 0,
        isVerified: p.sellerIsVerified,
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
