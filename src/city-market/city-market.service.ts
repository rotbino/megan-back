import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService, TTL } from '../common/cache/cache.module';
import { CategoriesService } from '../categories/categories.service';
import { LocationsService } from '../locations/locations.service';
import { UploadsService } from '../uploads/uploads.service';
import type { ProductDto } from '../products/products.service';
import type { GetCityMarketProductsDto } from './dto';

/**
 * سرویس «بازار عمدهٔ شهری» — مستقل از ProductsService (خواستهٔ مالک ۹-۱۱):
 * صفحه‌های /city/{slug} چندشهری می‌گیرند (شهر خود صفحه + شهرهای تیک‌خوردهٔ
 * همان استان) و این سرویس با یک کوئریِ `cityId IN (…)` جواب می‌دهد —
 * عین تک‌شهری سریع (ایندکس city_id)؛ فیلتر چندشهری به سرویس اصلی
 * getProductList هیچ بار/پیچیدگی‌ای اضافه نمی‌کند.
 *
 * fail-closed: بدون cityIds هیچ‌وقت لیست سراسری نمی‌دهد (ولیدیشن DTO:
 * حداقل یک شهر). سورت «مرتبط‌ترین» عین لیست ملی: نردبان ← فروشندهٔ ویژه ←
 * تازه‌ترین به‌روزرسانی (خواستهٔ مالک — جایگاه تبلیغاتی جدا ندارد).
 *
 * ⚠️ نگاشت ردیف→DTO (hydrateNames/toDto) عمداً کپی products.service است تا
 * این ماژول به سرویس اصلی وابسته نباشد؛ تایپ برگشتی همان ProductDto اصلی
 * است (import type) ⇒ اگر شکل DTO اصلی عوض شود، بیلد همین‌جا خطا می‌دهد.
 */

const PER_PAGE_DEFAULT = 16;
const DAY_MS = 86_400_000;

const isPriceExpired = (p: { priceUpdatedAt: Date | null; priceValidityDays?: number | null }): boolean =>
  p.priceUpdatedAt
    ? Date.now() > new Date(p.priceUpdatedAt).getTime() + (p.priceValidityDays ?? 3) * DAY_MS
    : false;

const fmtDate = (d: Date | null | undefined): string =>
  d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : '';

/** نام‌های join‌شده برای نمایش — عین NameMaps در products.service */
interface NameMaps {
  users: Map<string, { userName: string; firstName: string; lastName: string; isVerified: boolean; avatarUrl: string | null }>;
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
export class CityMarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly categories: CategoriesService,
    private readonly locations: LocationsService,
    private readonly uploads: UploadsService,
  ) {}

  /** POST /cityMarket/getProducts — لیست چندشهری بازار شهری (فقط confirmed) */
  async getProducts(dto: GetCityMarketProductsDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? PER_PAGE_DEFAULT;
    const sort = dto.sort === 'newest' ? 'newest' : 'related';

    return this.cache.wrap(
      `city-market:list:${JSON.stringify(dto)}`,
      // تگ products ⇒ هر ثبت/ویرایش/حذف آگهی کش بازار شهری را هم بیات می‌کند
      { ttlMs: TTL.SHORT, tags: ['products', 'city-market'] },
      async () => {
        const where: Prisma.ProductWhereInput = {
          status: 'confirmed',
          user: { isActive: true },
          // عضویت چندشهری — عین تک‌شهری روی ایندکس city_id (O(1) هر ردیف)
          cityId: { in: [...new Set(dto.cityIds)] },
        };

        // فیلتر دسته — خودش + درخت فرزندان (عین getProductList)
        if (dto.categorySlug) {
          const ids = await this.categories.getSubtreeIds(dto.categorySlug);
          if (ids.length === 0) return { items: [], total: 0, page, pageCount: 0 };
          where.OR = [
            { subCategoryId: { in: ids } },
            { categoryId: { in: ids } },
          ];
        }

        // جستجو — نام محصول + نام دسته (resolve از درخت کش‌شده)
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
            const catFilter = where.OR;
            where.AND = [{ OR: catFilter }, { OR: textMatch }];
            delete where.OR;
          } else {
            where.OR = textMatch;
          }
        }

        // نردبان منقضی عملاً غیرفعال است — فیلتر زنده
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : []),
          { OR: [{ isLadder: false }, { ladderExpiresAt: { gt: new Date() } }] },
        ];

        const orderBy: Prisma.ProductOrderByWithRelationInput[] =
          sort === 'newest'
            ? [{ updatedAt: 'desc' }]
            : // «مرتبط‌ترین» — نردبان اول، بعد آگهی‌های فروشندگان ویژه، بعد جدیدترین
              [{ isLadder: 'desc' }, { isElevated: 'desc' }, { updatedAt: 'desc' }];

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

  // ─── نگاشت نمایش — کپی products.service (مستقل، فقط تایپ مشترک) ────────────

  /** join نام‌ها — سه کوئری دسته‌ای؛ چون خروجی کش می‌شود فقط روی cache-miss اجرا می‌شود */
  private async hydrateNames(rows: Array<{ userId: string; categoryId: number; subCategoryId: number; provinceId: number; cityId: number }>): Promise<NameMaps> {
    if (rows.length === 0) return EMPTY_MAPS;

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const provinceIds = [...new Set(rows.map((r) => r.provinceId))];
    const cityIds = [...new Set(rows.map((r) => r.cityId))];
    const catIds = [...new Set(rows.flatMap((r) => [r.categoryId, r.subCategoryId]))];

    const [userRows, catMap, locNames] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, userName: true, firstName: true, lastName: true, isVerified: true, avatarUrl: true },
      }),
      this.categories.getNameMap(),
      this.locations.getNames(provinceIds, cityIds),
    ]);

    const users = new Map(
      userRows.map((u) => [
        u.id,
        { userName: u.userName, firstName: u.firstName, lastName: u.lastName, isVerified: u.isVerified, avatarUrl: u.avatarUrl },
      ]),
    );
    const cats = new Map<number, string>();
    for (const id of catIds) cats.set(id, catMap.get(id)?.category_name ?? '—');

    return { users, cats, provs: locNames.provinces, cities: locNames.cities };
  }

  /** نگاشت ردیف DB → DTO فرانت (camelCase) — عین toDto در products.service */
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
      isElevated: boolean;
      hasVideo: boolean;
      isOld: boolean;
      viewCount: number;
      priceValidityDays?: number | null;
      priceUpdatedAt?: Date | null;
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
        avatarUrl: seller?.avatarUrl ?? null,
      },
      isLadder: p.isLadder,
      isElevated: p.isElevated,
      hasVideo: p.hasVideo,
      isOld: p.isOld,
      viewCount: p.viewCount,
      priceValidityDays: p.priceValidityDays ?? 3,
      priceUpdatedAt: fmtDate(p.priceUpdatedAt ?? null),
      priceExpired: isPriceExpired({
        priceUpdatedAt: p.priceUpdatedAt ?? null,
        priceValidityDays: p.priceValidityDays,
      }),
      createdAt: fmtDate(p.createdAt),
      updatedAt: fmtDate(p.updatedAt),
      photos,
      photoThumbs,
      status: p.status,
      features,
      ...(p.status !== 'confirmed' ? { rejectionReasons } : {}),
    };
  }
}
