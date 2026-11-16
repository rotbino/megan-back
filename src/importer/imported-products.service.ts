/**
 * مدیریت آگهی‌های ایمپورت‌شده (خواستهٔ مالک ۱۳-۱۱) — پشت دو صفحهٔ جدید
 * «دیتا ایمپورت → آگهی‌ها» و «دیتا ایمپورت → تصاویر آگهی‌ها»:
 *
 *   • آگهی‌ها: کدام آگهی از باسکول آمده (فروشنده‌اش سند b دارد) و کدام طبیعی
 *     ثبت شده؛ کدام فروشنده‌اش آمده لاگین کرده؛ کدام توسط خود فروشنده ویرایش
 *     شده (ProductEditHistory با action=edit)؛ وضعیت/بدون‌عکس/تعداد عکس و
 *     مهرهای زمانی دقیق باسکول — برای تسلط بر مخلوط آگهی‌های باسکولی و خودی.
 *   • تصاویر آگهی‌ها: آلبوم صفحه‌به‌صفحه (۲۰تایی) از فایل‌های گالری آگهی‌ها
 *     برای یافتن واترمارک باسکول؛ تعویض بایت‌ها «درجا» (همان کلید/نام/مسیر)
 *     از طریق UploadsService.replaceInPlace انجام می‌شود.
 *
 * پیاده‌سازی: aggregation خام مونگو ($runCommandRaw) — عین الگوی
 * ImportedUsersService؛ نام فیلدهای خام (@map) عمداً استفاده می‌شوند.
 */

import { Injectable } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { mongoDateRange } from './date-range.util';
import type { ImportedListingsQueryDto, ProductImagesQueryDto } from './dto';

// ─── قرارداد API (آینهٔ فرانت: lib/importer/client.ts) ──────────────────────

export interface ImportedListingRow {
  id: number;
  productName: string;
  slug: string;
  status: string;
  unit: string;
  categoryId: number;
  subCategoryId: number;
  categoryName: string | null;
  subCategoryName: string | null;
  provinceId: number;
  cityId: number;
  provinceName: string | null;
  cityName: string | null;
  stock: number;
  minSalePrice: number;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  priceUpdatedAt: string | null;
  /** منبع: فروشنده سند b دارد (باسکولی) یا ثبت‌نام خودی */
  source: 'buskool' | 'native';
  owner: {
    id: string;
    userName: string;
    firstName: string;
    lastName: string;
    phone: string;
    bUserName: string | null;
    lastLoginAt: string | null;
  };
  /** ویرایش‌شده توسط خود فروشنده (دست‌کم یک action=edit) */
  edited: boolean;
  lastEditedAt: string | null;
  photoCount: number;
  photoThumb: string | null;
}

export interface ImportedListingsSummary {
  total: number;
  buskool: number;
  native: number;
  ownerLoggedIn: number;
  editedByUser: number;
  withoutPhotos: number;
  pending: number;
}

export interface ImportedListingsList {
  rows: ImportedListingRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: ImportedListingsSummary;
}

export interface ProductImageRow {
  id: string;
  url: string;
  thumbUrl: string | null;
  size: number;
  mimeType: string;
  name: string;
  /** زمان ایمپورت/آپلود اولیه */
  createdAt: string;
  /** آخرین تعویض درجا (بایت‌های تازه) */
  updatedAt: string;
  width: number | null;
  height: number | null;
  source: 'buskool' | 'native';
  importedFrom: string | null;
  /** URL اصلی فایل در باسکول (قبل از rehost در آیمچ) */
  originalUrl: string | null;
  /** آخرین تعویض توسط ادمین (metadata.replacedAt) */
  replacedAt: string | null;
  product: {
    id: number;
    name: string;
    slug: string;
    status: string;
    /** تاریخ ثبت/آپدیت خودِ آگهی (باسکول) — معنادار برای شکار واترمارک */
    createdAt: string;
    updatedAt: string;
  } | null;
  owner: { id: string; userName: string; name: string; phone: string; bUserName: string | null } | null;
}

export interface ProductImagesSummary {
  total: number;
  buskool: number;
  native: number;
  replaced: number;
  /** باسکولی‌های هنوز تعویض‌نشده — باقی‌ماندهٔ کار پاک‌کردن واترمارک */
  buskoolRemaining: number;
}

export interface ProductImagesList {
  rows: ProductImageRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: ProductImagesSummary;
}

/** عکس داخل کارت گروهی — بدون تکرار محصول/مالک (روی ردیف گروه هست) */
export type ProductImageGroupPhoto = Omit<ProductImageRow, 'product' | 'owner'>;

/** ردیف گروهی (خواستهٔ مالک ۱۶-۱۱ عصر): هر آگهی یک کارت با «همهٔ» عکس‌هایش —
 *  چیدمان تخت قبلی هر عکس را ردیف جدا می‌داد و آگهی چندعکسه چندبار تکرار می‌شد؛
 *  حالا همهٔ عکس‌های یک آگهی کنار هم‌اند تا واترمارک باسکول روی هیچ‌کدام از قلم نیفتد */
export interface ProductImageGroupRow {
  product: NonNullable<ProductImageRow['product']>;
  owner: ProductImageRow['owner'];
  /** همهٔ عکس‌های گالری آگهی — مرتب با ترتیب گالری (ثبت فایل صعودی) */
  photos: ProductImageGroupPhoto[];
  photoCount: number;
  totalSize: number;
}

export interface ProductImagesGroupedList {
  rows: ProductImageGroupRow[];
  /** تعداد آگهی‌های منطبق (صفحه‌بندی بر آگهی، نه بر فایل) */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: ProductImagesSummary;
}

// ─── ابزارها ────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** تاریخ خروجی $runCommandRaw — EJSON {$date} یا Date یا رشتهٔ ISO */
function toIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v) return v;
  if (v && typeof v === 'object') {
    const d = (v as { $date?: unknown }).$date;
    if (typeof d === 'string') return d;
    if (d instanceof Date) return d.toISOString();
  }
  return null;
}

/** ObjectId خروجی $runCommandRaw — EJSON {$oid} یا رشته */
function toId(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const oid = (v as { $oid?: unknown }).$oid;
    if (typeof oid === 'string') return oid;
  }
  return String(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

@Injectable()
export class ImportedProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════ آگهی‌ها: لیست ═══════════════════════════

  async list(query: ImportedListingsQueryDto): Promise<ImportedListingsList> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(5, query.pageSize ?? 20));
    const dir = query.dir === 'asc' ? 1 : -1;
    const q = query.q?.trim();

    // ── فیلتر پایه روی خود آگهی ──
    const base: Record<string, unknown> = {};
    if (query.status && query.status !== 'all') base.status = query.status;

    // بازهٔ تاریخ ثبت/آپدیت (خواستهٔ مالک ۱۵-۱۱) — EJSON {$date}
    const createdRange = mongoDateRange(query.createdFrom, query.createdTo);
    if (createdRange) base.created_at = createdRange;
    const updatedRange = mongoDateRange(query.updatedFrom, query.updatedTo);
    if (updatedRange) base.updated_at = updatedRange;

    // ── فیلترهای سمت فروشنده + جستجو — بعد از lookup مالک اعمال می‌شوند ──
    const ownerMatch: Record<string, unknown> = {};
    if (query.source === 'buskool') ownerMatch['owner.b_user_name'] = { $ne: null };
    else if (query.source === 'native') ownerMatch['owner.b_user_name'] = null;
    if (query.ownerLogin === 'ever') ownerMatch['owner.last_login_at'] = { $ne: null };
    else if (query.ownerLogin === 'never') ownerMatch['owner.last_login_at'] = null;
    if (q) {
      const re = { $regex: escapeRegex(q), $options: 'i' };
      const or: Record<string, unknown>[] = [
        { product_name: re },
        { slug: re },
        { 'owner.phone': re },
        { 'owner.user_name': re },
        { 'owner.first_name': re },
        { 'owner.last_name': re },
        { 'owner.b_user_name': re },
      ];
      if (/^\d+$/.test(q)) or.push({ _id: parseInt(q, 10) });
      ownerMatch.$or = or;
    }

    const pre: Record<string, unknown>[] = [
      { $match: base },
      { $lookup: { from: 'User', localField: 'user_id', foreignField: '_id', as: 'owner' } },
      { $unwind: '$owner' },
      ...(Object.keys(ownerMatch).length ? [{ $match: ownerMatch }] : []),
    ];

    // فیلترهای وابسته به lookup (ویرایش/عکس) — قبل از صفحه‌بندی اعمال می‌شوند
    if (query.edited === 'yes' || query.edited === 'no') {
      pre.push(this.editsLookup());
      const want = query.edited === 'yes';
      pre.push({
        $match: { $expr: { [want ? '$gt' : '$eq']: [{ $size: { $ifNull: ['$_edits', []] } }, 0] } },
      });
    }
    if (query.hasPhotos === 'yes' || query.hasPhotos === 'no') {
      pre.push(this.photosLookup());
      const want = query.hasPhotos === 'yes';
      pre.push({
        $match: { $expr: { [want ? '$gt' : '$eq']: [{ $size: { $ifNull: ['$_photos', []] } }, 0] } },
      });
    }

    const sortKey: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      priceUpdatedAt: 'price_updated_at',
      views: 'view_count',
      name: 'product_name',
    };
    const sortField = sortKey[query.sort ?? 'createdAt'] ?? 'created_at';

    const pipeline: Record<string, unknown>[] = [
      ...pre,
      {
        $facet: {
          rows: [
            { $sort: { [sortField]: dir, _id: dir } },
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize },
            // برای نمایش: ویرایش‌ها + عکس‌ها فقط برای ۲۰ ردیف این صفحه
            this.editsLookup(),
            this.photosLookup(),
            {
              $project: {
                _id: 1,
                product_name: 1,
                slug: 1,
                status: 1,
                unit: 1,
                category_id: 1,
                sub_category_id: 1,
                province_id: 1,
                city_id: 1,
                stock: 1,
                min_sale_price: 1,
                view_count: 1,
                created_at: 1,
                updated_at: 1,
                price_updated_at: 1,
                _edits: 1,
                _photos: 1,
                owner: {
                  _id: 1,
                  phone: 1,
                  user_name: 1,
                  b_user_name: 1,
                  first_name: 1,
                  last_name: 1,
                  last_login_at: 1,
                },
              },
            },
          ],
          total: [{ $count: 'n' }],
        },
      },
    ];

    const agg = (await this.prisma.$runCommandRaw({
      aggregate: 'Product',
      pipeline: pipeline as unknown as Prisma.InputJsonObject[],
      cursor: {},
    })) as unknown as { cursor?: { firstBatch?: Record<string, unknown>[] } };
    const facet = agg?.cursor?.firstBatch?.[0] ?? {};
    const rawRows = (facet.rows ?? []) as Record<string, unknown>[];
    const total = Number(((facet.total ?? []) as { n?: number }[])[0]?.n ?? 0);

    // ── نام دسته/استان/شهر برای ردیف‌های این صفحه ──
    const catIds = [
      ...new Set(
        rawRows
          .flatMap((r) => [r.category_id, r.sub_category_id])
          .filter((x): x is number => typeof x === 'number'),
      ),
    ];
    const provIds = [...new Set(rawRows.map((r) => r.province_id).filter((x): x is number => x != null))];
    const cityIds = [...new Set(rawRows.map((r) => r.city_id).filter((x): x is number => x != null))];
    const [cats, locs] = await Promise.all([
      catIds.length
        ? this.prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, categoryName: true } })
        : [],
      provIds.length || cityIds.length
        ? this.prisma.location.findMany({
            where: { buskolId: { in: [...provIds, ...cityIds] } },
            select: { buskolId: true, name: true, type: true },
          })
        : [],
    ]);
    const catName = new Map(cats.map((c) => [c.id, c.categoryName]));
    const provName = new Map(locs.filter((l) => l.type === 'province').map((l) => [l.buskolId, l.name]));
    const cityName = new Map(locs.filter((l) => l.type === 'city').map((l) => [l.buskolId, l.name]));

    const rows: ImportedListingRow[] = rawRows.map((r) => {
      const owner = (r.owner ?? {}) as Record<string, unknown>;
      const edits = (r._edits ?? []) as { created_at?: unknown }[];
      const photos = (r._photos ?? []) as { url?: unknown; thumb_url?: unknown }[];
      const lastEdited = edits
        .map((e) => toIso(e.created_at))
        .filter((x): x is string => Boolean(x))
        .sort()
        .pop();
      const firstPhoto = photos[0] ?? {};
      return {
        id: Number(r._id),
        productName: String(r.product_name ?? ''),
        slug: String(r.slug ?? ''),
        status: String(r.status ?? 'pending'),
        unit: String(r.unit ?? ''),
        categoryId: Number(r.category_id ?? 0),
        subCategoryId: Number(r.sub_category_id ?? 0),
        categoryName: catName.get(Number(r.category_id ?? -1)) ?? null,
        subCategoryName: catName.get(Number(r.sub_category_id ?? -1)) ?? null,
        provinceId: Number(r.province_id ?? 0),
        cityId: Number(r.city_id ?? 0),
        provinceName: provName.get(Number(r.province_id ?? -1)) ?? null,
        cityName: cityName.get(Number(r.city_id ?? -1)) ?? null,
        stock: Number(r.stock ?? 0),
        minSalePrice: Number(r.min_sale_price ?? 0),
        viewCount: Number(r.view_count ?? 0),
        createdAt: toIso(r.created_at) ?? '',
        updatedAt: toIso(r.updated_at) ?? '',
        priceUpdatedAt: toIso(r.price_updated_at),
        source: owner.b_user_name != null ? 'buskool' : 'native',
        owner: {
          id: toId(owner._id),
          userName: String(owner.user_name ?? ''),
          firstName: String(owner.first_name ?? ''),
          lastName: String(owner.last_name ?? ''),
          phone: String(owner.phone ?? ''),
          bUserName: (owner.b_user_name as string) ?? null,
          lastLoginAt: toIso(owner.last_login_at),
        },
        edited: edits.length > 0,
        lastEditedAt: lastEdited ?? null,
        photoCount: photos.length,
        photoThumb: (firstPhoto.thumb_url as string) ?? (firstPhoto.url as string) ?? null,
      };
    });

    return {
      rows,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      summary: await this.summary(),
    };
  }

  /** آمار کلی آگهی‌ها (مستقل از فیلترها) — کارت‌های بالای صفحه */
  async summary(): Promise<ImportedListingsSummary> {
    const agg = (await this.prisma.$runCommandRaw({
      aggregate: 'Product',
      pipeline: [
        { $lookup: { from: 'User', localField: 'user_id', foreignField: '_id', as: 'owner' } },
        { $unwind: '$owner' },
        this.editsLookup(),
        this.photosLookup(),
        {
          $addFields: {
            _edited: { $gt: [{ $size: { $ifNull: ['$_edits', []] } }, 0] },
            _photoCount: { $size: { $ifNull: ['$_photos', []] } },
          },
        },
        {
          $facet: {
            total: [{ $count: 'n' }],
            buskool: [{ $match: { 'owner.b_user_name': { $ne: null } } }, { $count: 'n' }],
            native: [{ $match: { 'owner.b_user_name': null } }, { $count: 'n' }],
            ownerLoggedIn: [{ $match: { 'owner.last_login_at': { $ne: null } } }, { $count: 'n' }],
            editedByUser: [{ $match: { _edited: true } }, { $count: 'n' }],
            withoutPhotos: [{ $match: { $expr: { $eq: ['$_photoCount', 0] } } }, { $count: 'n' }],
            pending: [{ $match: { status: 'pending' } }, { $count: 'n' }],
          },
        },
      ] as unknown as Prisma.InputJsonObject[],
      cursor: {},
    })) as unknown as { cursor?: { firstBatch?: Record<string, unknown>[] } };
    const f = agg?.cursor?.firstBatch?.[0] ?? {};
    const cnt = (key: string): number => Number(((f[key] ?? []) as { n?: number }[])[0]?.n ?? 0);
    const total = cnt('total');
    const buskool = cnt('buskool');
    return {
      total,
      buskool,
      native: cnt('native'),
      ownerLoggedIn: cnt('ownerLoggedIn'),
      editedByUser: cnt('editedByUser'),
      withoutPhotos: cnt('withoutPhotos'),
      pending: cnt('pending'),
      // native = بقیه — برای مقاوم‌شدن در برابر دادهٔ کثیف (مالک یتیم و…) از تفریق نیست
    };
  }

  // ═══════════════════════════ تصاویر آگهی‌ها: آلبوم ═══════════════════════════

  async listImages(query: ProductImagesQueryDto): Promise<ProductImagesList | ProductImagesGroupedList> {
    // حالت گروهی (خواستهٔ مالک ۱۶-۱۱ عصر): هر آگهی یک کارت با همهٔ عکس‌هایش
    if (query.group === 'product') {
      return this.listImagesGrouped(query);
    }
    const page = Math.max(1, query.page ?? 1);
    // پیش‌فرض ۵۰ (خواستهٔ مالک ۱۵-۱۱: ۵۰ رکورد در هر صفحه)
    const pageSize = Math.min(100, Math.max(4, query.pageSize ?? 50));

    // ── سورت (خواستهٔ مالک ۱۵-۱۱): پیش‌فرض آخرین آپدیتِ آگهی، بعد ثبت آگهی ──
    // ⚠️ تاریخ‌های خودِ فایل (created_at/updated_at) همگی «زمان ایمپورت»‌اند و
    // برای شکار واترمارک بی‌معنا هستند — تاریخ‌های معنا‌دار روی خودِ آگهی‌اند
    // (باسکول: ثبت/آپدیت). پس سورت‌های اصلی روی تاریخ آگهی‌اند.
    const legacy = query.sort === 'newest' || query.sort === 'oldest';
    const sortName = legacy ? 'createdAt' : (query.sort ?? 'productUpdated');
    const dir =
      query.dir === 'asc' ? 1 : query.dir === 'desc' ? -1 : legacy && query.sort === 'oldest' ? 1 : -1;

    // سورت‌های مستقیم روی فایل — بقیه (تاریخ آگهی) با رتبهٔ تزریق‌شده
    const fileSortKey: Record<string, string> = {
      createdAt: 'created_at', // زمان ایمپورت تصویر
      updatedAt: 'updated_at', // آخرین تغییر/تعویض تصویر
      productId: '_pid', // related_id عددی — با $convert قبل از $sort
      size: 'size',
    };
    const productDateSort: Record<string, ['createdAt' | 'updatedAt', 'createdAt' | 'updatedAt']> = {
      // [تاریخ اصلی، تاریخ ثانویه] روی خودِ آگهی — نام فیلدهای Prisma
      productUpdated: ['updatedAt', 'createdAt'],
      productCreated: ['createdAt', 'updatedAt'],
    };
    const isProductDateSort = sortName in productDateSort;
    const fileSortField = !isProductDateSort ? (fileSortKey[sortName] ?? 'updated_at') : null;

    const q = query.q?.trim();

    const filter: Record<string, unknown> = {
      related_model: 'Product',
      field_key: 'gallery',
      related_id: { $ne: null },
    };
    if (query.source === 'buskool') filter['metadata.importedFrom'] = 'buskool';
    else if (query.source === 'native') filter['metadata.importedFrom'] = { $ne: 'buskool' };
    if (query.replaced === 'yes') filter['metadata.replacedAt'] = { $ne: null };
    else if (query.replaced === 'no') filter['metadata.replacedAt'] = null;

    // ── بازهٔ تاریخِ خودِ آگهی (خواستهٔ مالک ۱۵-۱۱: «آگهی‌ها رو در بازه بر حسب
    // ثبت و آپدیت فیلتر کن تا تصاویر واترمارک‌دار پیدا شوند») — کلکشن آگهی
    // کوچک است؛ idهای در بازه از قبل خوانده و با $in به فایل‌ها اعمال می‌شود.
    const productCreatedRange = mongoDateRange(query.createdFrom, query.createdTo);
    const productUpdatedRange = mongoDateRange(query.updatedFrom, query.updatedTo);
    let rangeProductIds: string[] | null = null;
    if (productCreatedRange || productUpdatedRange) {
      /** شرط بازهٔ نیمه‌باز — gte/lte فقط وقتی طرفش ست شده */
      const between = (from?: string, to?: string) => ({
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      });
      const inRange = await this.prisma.product.findMany({
        where: {
          ...(productCreatedRange ? { createdAt: between(query.createdFrom, query.createdTo) } : {}),
          ...(productUpdatedRange ? { updatedAt: between(query.updatedFrom, query.updatedTo) } : {}),
        },
        select: { id: true },
        take: 50_000,
      });
      rangeProductIds = inRange.map((p) => String(p.id));
      if (rangeProductIds.length === 0) {
        return {
          rows: [],
          total: 0,
          page,
          pageSize,
          pageCount: 1,
          summary: await this.imagesSummary(),
        };
      }
    }

    // جستجو → مجموعهٔ id آگهی‌های منطبق (نام/شناسهٔ آگهی یا نام/شماره/یوزرنیم
    // فروشنده) — قبل از pipeline تا آلبوم بدون lookup سراسری صفحه‌بندی شود
    if (q) {
      const contains = { contains: q, mode: 'insensitive' as const };
      const prodOr: Prisma.ProductWhereInput[] = [{ productName: contains }, { slug: contains }];
      if (/^\d+$/.test(q)) prodOr.push({ id: Number(q) });
      const [byName, owners] = await Promise.all([
        this.prisma.product.findMany({ where: { OR: prodOr }, select: { id: true }, take: 5000 }),
        this.prisma.user.findMany({
          where: {
            OR: [
              { phone: contains },
              { userName: contains },
              { firstName: contains },
              { lastName: contains },
              { bUserName: contains },
            ],
          },
          select: { id: true },
          take: 2000,
        }),
      ]);
      const ids = new Set(byName.map((p) => p.id));
      if (owners.length > 0) {
        const owned = await this.prisma.product.findMany({
          where: { userId: { in: owners.map((u) => u.id) } },
          select: { id: true },
          take: 5000,
        });
        for (const p of owned) ids.add(p.id);
      }
      if (ids.size === 0) {
        return {
          rows: [],
          total: 0,
          page,
          pageSize,
          pageCount: 1,
          summary: await this.imagesSummary(),
        };
      }
      // تلاقی جستجو با بازهٔ تاریخ آگهی (هر دو روی related_id اند)
      const qIds = [...ids].map(String);
      filter.related_id =
        rangeProductIds != null ? { $in: qIds.filter((x) => rangeProductIds.includes(x)) } : { $in: qIds };
      if (rangeProductIds != null && (filter.related_id as { $in: string[] }).$in.length === 0) {
        return {
          rows: [],
          total: 0,
          page,
          pageSize,
          pageCount: 1,
          summary: await this.imagesSummary(),
        };
      }
    } else if (rangeProductIds != null) {
      filter.related_id = { $in: rangeProductIds };
    }

    // ── سورت بر اساس تاریخ آگهی: آرایهٔ idهای مرتب از قبل ساخته می‌شود و
    // رتبه در pipeline با $indexOfArray تزریق می‌شود (کلکشن آگهی کوچک است؛
    // ترتیب آرایه خودِ جهت سورت را می‌دهد → همیشه _prio صعودی مرتب می‌شود).
    // ثانویه (همان‌طور که مالک خواست: «اول آپدیت، بعد ثبت») داخل ترتیب
    // آرایه است؛ فایل‌های بدون آگهی با رتبهٔ بزرگ آخر می‌روند.
    let rankProductIds: string[] | null = null;
    if (isProductDateSort) {
      const [primaryDate, secondaryDate] = productDateSort[sortName];
      type RankRow = { id: number; createdAt: Date; updatedAt: Date };
      const dateOf = (row: RankRow, key: 'createdAt' | 'updatedAt'): number =>
        new Date(row[key]).getTime() || 0;
      const productsForRank = await this.prisma.product.findMany({
        where:
          rangeProductIds != null
            ? { id: { in: rangeProductIds.map(Number) } }
            : q
              ? { id: { in: (filter.related_id as { $in: string[] }).$in.map(Number) } }
              : undefined,
        select: { id: true, createdAt: true, updatedAt: true },
        take: 50_000,
      });
      productsForRank.sort((a, b) => {
        const pa = dateOf(a, primaryDate);
        const pb = dateOf(b, primaryDate);
        if (pa !== pb) return dir === 1 ? pa - pb : pb - pa;
        const sa = dateOf(a, secondaryDate);
        const sb = dateOf(b, secondaryDate);
        if (sa !== sb) return dir === 1 ? sa - sb : sb - sa;
        return dir === 1 ? a.id - b.id : b.id - a.id;
      });
      rankProductIds = productsForRank.map((p) => String(p.id));
    }

    const [totalAgg, rowsAgg] = await Promise.all([
      this.prisma.$runCommandRaw({
        aggregate: 'File',
        pipeline: [{ $match: filter }, { $count: 'n' }] as unknown as Prisma.InputJsonObject[],
        cursor: {},
      }) as unknown as { cursor?: { firstBatch?: { n?: number }[] } },
      this.prisma.$runCommandRaw({
        aggregate: 'File',
        pipeline: [
          { $match: filter },
          // سورت تاریخ آگهی — رتبهٔ تزریق‌شده از آرایهٔ مرتب
          ...(rankProductIds
            ? [
                {
                  $addFields: {
                    // $let: یک بار $indexOfArray محاسبه می‌شود (نه دوبار در $cond)
                    _prio: {
                      $let: {
                        vars: { r: { $indexOfArray: [rankProductIds, '$related_id'] } },
                        in: {
                          $cond: [
                            // -1 = فایل بدون آگهی (حذف‌شده) → همیشه آخر
                            { $eq: ['$$r', -1] },
                            Number.MAX_SAFE_INTEGER,
                            '$$r',
                          ],
                        },
                      },
                    },
                  },
                },
                { $sort: { _prio: 1, _id: 1 } },
              ]
            : []),
          // سورت بر اساس شناسهٔ آگهی: related_id رشته است → تبدیل عددی قبل از $sort
          ...(fileSortField === '_pid'
            ? [
                {
                  $addFields: {
                    _pid: {
                      $convert: { input: '$related_id', to: 'long', onError: null, onNull: null },
                    },
                  },
                },
              ]
            : []),
          // سورت مستقیم روی فایل — ثانویه = تاریخ ثبت فایل، tertiary = _id
          ...(fileSortField && fileSortField !== '_pid'
            ? [{ $sort: { [fileSortField]: dir, created_at: dir, _id: dir } }]
            : []),
          ...(fileSortField === '_pid' ? [{ $sort: { _pid: dir, created_at: dir, _id: dir } } ] : []),
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          // آگهیِ صاحب عکس — مقایسهٔ رشته‌ای امن (related_id رشته است، _id عدد)
          {
            $lookup: {
              from: 'Product',
              let: { rid: '$related_id' },
              pipeline: [{ $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$rid'] } } }],
              as: 'product',
            },
          },
          { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
          { $lookup: { from: 'User', localField: 'product.user_id', foreignField: '_id', as: 'ownerUser' } },
          {
            $project: {
              url: 1,
              thumb_url: 1,
              size: 1,
              mime_type: 1,
              name: 1,
              created_at: 1,
              updated_at: 1,
              metadata: 1,
              product: { _id: 1, product_name: 1, slug: 1, status: 1, created_at: 1, updated_at: 1 },
              ownerUser: { _id: 1, phone: 1, user_name: 1, b_user_name: 1, first_name: 1, last_name: 1 },
            },
          },
        ] as unknown as Prisma.InputJsonObject[],
        cursor: {},
      }) as unknown as { cursor?: { firstBatch?: Record<string, unknown>[] } },
    ]);

    const total = Number(totalAgg?.cursor?.firstBatch?.[0]?.n ?? 0);
    const rawRows = rowsAgg?.cursor?.firstBatch ?? [];

    const rows: ProductImageRow[] = rawRows.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const owner = ((r.ownerUser ?? []) as Record<string, unknown>[])[0];
      const product = r.product as Record<string, unknown> | null;
      const firstName = owner ? String(owner.first_name ?? '') : '';
      const lastName = owner ? String(owner.last_name ?? '') : '';
      return {
        id: toId(r._id),
        url: String(r.url ?? ''),
        thumbUrl: (r.thumb_url as string) ?? null,
        size: Number(r.size ?? 0),
        mimeType: String(r.mime_type ?? ''),
        name: String(r.name ?? ''),
        createdAt: toIso(r.created_at) ?? '',
        updatedAt: toIso(r.updated_at) ?? '',
        width: num(meta.width),
        height: num(meta.height),
        source: meta.importedFrom === 'buskool' ? 'buskool' : 'native',
        importedFrom: typeof meta.importedFrom === 'string' ? meta.importedFrom : null,
        originalUrl: typeof meta.originalUrl === 'string' ? meta.originalUrl : null,
        replacedAt: typeof meta.replacedAt === 'string' ? meta.replacedAt : null,
        product: product
          ? {
              id: Number(product._id),
              name: String(product.product_name ?? ''),
              slug: String(product.slug ?? ''),
              status: String(product.status ?? ''),
              // تاریخ‌های خودِ آگهی (باسکول) — مبنای سورت/فیلتر شکار واترمارک
              createdAt: toIso(product.created_at) ?? '',
              updatedAt: toIso(product.updated_at) ?? '',
            }
          : null,
        owner: owner
          ? {
              id: toId(owner._id),
              userName: String(owner.user_name ?? ''),
              name: `${firstName} ${lastName}`.trim(),
              phone: String(owner.phone ?? ''),
              bUserName: (owner.b_user_name as string) ?? null,
            }
          : null,
      };
    });

    return {
      rows,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      summary: await this.imagesSummary(),
    };
  }

  // ═══════════════ تصاویر آگهی‌ها: گروهی (هر آگهی یک کارت) ═══════════════

  /**
   * آلبوم گروهی (خواستهٔ مالک ۱۶-۱۱ عصر): هر آگهی یک ردیف با «همهٔ» عکس‌هایش.
   * صفحه‌بندی بر آگهی (نه بر فایل) — عکس‌های یک آگهی هرگز بین دو صفحه نمی‌شکافند.
   * سورت‌ها: تاریخ آگهی (پرایسما، سبک) / تعداد عکس و حجم کل (اگریگیت روی File).
   */
  private async listImagesGrouped(query: ProductImagesQueryDto): Promise<ProductImagesGroupedList> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(4, query.pageSize ?? 50));
    const dir = query.dir === 'asc' ? 1 : -1;
    const prismaDir = query.dir === 'asc' ? ('asc' as const) : ('desc' as const);
    const summary = this.imagesSummary();

    const empty = async (): Promise<ProductImagesGroupedList> => ({
      rows: [],
      total: 0,
      page,
      pageSize,
      pageCount: 1,
      summary: await summary,
    });

    // ── ۱) آگهی‌های منطبق با جستجو/بازهٔ تاریخ (همان منطق حالت تخت) ──
    const textIds = await this.productIdsFromTextFilters(query);
    if (textIds !== null && textIds.length === 0) return empty();

    // ── ۲) فیلترهای فایلی (منبع/وضعیت تعویض) → آگهیِ دارای فایل منطبق ──
    //  'no' = هنوز عکس تعویض‌نشده دارد (کار باقی‌مانده) / 'yes' = حداقل یک عکس تعویض‌شده
    const fileFilterNeeded =
      query.source === 'buskool' || query.source === 'native' || query.replaced === 'yes' || query.replaced === 'no';
    let fileIds: string[] | null = null;
    if (fileFilterNeeded) {
      const fileMatch: Record<string, unknown> = {
        related_model: 'Product',
        field_key: 'gallery',
        related_id: { $ne: null },
      };
      if (query.source === 'buskool') fileMatch['metadata.importedFrom'] = 'buskool';
      else if (query.source === 'native') fileMatch['metadata.importedFrom'] = { $ne: 'buskool' };
      if (query.replaced === 'yes') fileMatch['metadata.replacedAt'] = { $ne: null };
      else if (query.replaced === 'no') fileMatch['metadata.replacedAt'] = null;
      const agg = (await this.prisma.$runCommandRaw({
        aggregate: 'File',
        pipeline: [
          { $match: fileMatch },
          { $group: { _id: '$related_id' } },
          { $limit: 50_000 },
        ] as unknown as Prisma.InputJsonObject[],
        cursor: {},
      })) as unknown as { cursor?: { firstBatch?: { _id: string }[] } };
      fileIds = (agg?.cursor?.firstBatch ?? []).map((r) => String(r._id));
      if (fileIds.length === 0) return empty();
    }

    // تلاقی دو مجموعه
    let matchedIds: number[] | null = null;
    if (textIds != null || fileIds != null) {
      if (textIds != null && fileIds != null) {
        const fileSet = new Set(fileIds);
        matchedIds = textIds.filter((x) => fileSet.has(x)).map(Number);
      } else {
        matchedIds = (textIds ?? fileIds!).map(Number);
      }
      if (matchedIds.length === 0) return empty();
    }

    // ── ۳) سورت + صفحه‌بندی بر آگهی ──
    const sortName = query.sort ?? 'productUpdated';
    let total = 0;
    let pageProducts: Product[];

    if (sortName === 'size' || sortName === 'photoCount') {
      // سورت‌های فایلی — اگریگیت سبک (فقط size) روی کل مجموعهٔ منطبق
      const primary = sortName === 'size' ? '_totalSize' : '_photoCount';
      const secondary = sortName === 'size' ? '_photoCount' : '_totalSize';
      const agg = (await this.prisma.$runCommandRaw({
        aggregate: 'Product',
        pipeline: [
          ...(matchedIds ? [{ $match: { _id: { $in: matchedIds } } }] : []),
          {
            $lookup: {
              from: 'File',
              let: { pid: { $toString: '$_id' } },
              pipeline: [
                {
                  $match: {
                    related_model: 'Product',
                    field_key: 'gallery',
                    $expr: { $eq: ['$related_id', '$$pid'] },
                  },
                },
                { $project: { size: 1 } },
              ],
              as: '_ph',
            },
          },
          {
            $addFields: {
              _totalSize: { $sum: '$_ph.size' },
              _photoCount: { $size: '$_ph' },
            },
          },
          { $sort: { [primary]: dir, [secondary]: dir, _id: dir } },
          {
            $facet: {
              total: [{ $count: 'n' }],
              rows: [
                { $skip: (page - 1) * pageSize },
                { $limit: pageSize },
                { $project: { _id: 1 } },
              ],
            },
          },
        ] as unknown as Prisma.InputJsonObject[],
        cursor: {},
      })) as unknown as {
        cursor?: { firstBatch?: { total?: { n?: number }[]; rows?: { _id: number }[] }[] };
      };
      const facet = agg?.cursor?.firstBatch?.[0] ?? {};
      total = Number(facet.total?.[0]?.n ?? 0);
      const idsOnPage = (facet.rows ?? []).map((r) => Number(r._id));
      pageProducts = idsOnPage.length
        ? await this.prisma.product.findMany({
            where: { id: { in: idsOnPage } },
            // ترتیب اگریگیت حفظ شود
          }).then((ps) => idsOnPage.map((id) => ps.find((p) => p.id === id)!).filter(Boolean))
        : [];
    } else {
      // سورت‌های خودِ آگهی — مستقیم پرایسما (سبک و ایندکس‌دار)
      const orderBy: Prisma.ProductOrderByWithRelationInput[] =
        sortName === 'productCreated'
          ? [{ createdAt: prismaDir }, { updatedAt: prismaDir }, { id: prismaDir }]
          : sortName === 'productId'
            ? [{ id: prismaDir }]
            : [{ updatedAt: prismaDir }, { createdAt: prismaDir }, { id: prismaDir }];
      const where: Prisma.ProductWhereInput = matchedIds ? { id: { in: matchedIds } } : {};
      total = await this.prisma.product.count({ where });
      pageProducts = await this.prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
    }

    if (pageProducts.length === 0) {
      return { rows: [], total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)), summary: await summary };
    }

    // ── ۴) همهٔ فایل‌های گالریِ آگهی‌های همین صفحه (ترتیب گالری = ثبت فایل) ──
    const pageIdStrings = pageProducts.map((p) => String(p.id));
    const filesAgg = (await this.prisma.$runCommandRaw({
      aggregate: 'File',
      pipeline: [
        { $match: { related_model: 'Product', field_key: 'gallery', related_id: { $in: pageIdStrings } } },
        { $sort: { related_id: 1, created_at: 1, _id: 1 } },
      ] as unknown as Prisma.InputJsonObject[],
      cursor: {},
    })) as unknown as { cursor?: { firstBatch?: Record<string, unknown>[] } };
    const filesByProduct = new Map<string, Record<string, unknown>[]>();
    for (const f of filesAgg?.cursor?.firstBatch ?? []) {
      const key = String(f.related_id ?? '');
      const arr = filesByProduct.get(key) ?? [];
      arr.push(f);
      filesByProduct.set(key, arr);
    }

    // ── ۵) مالکان ──
    const ownerIds = [...new Set(pageProducts.map((p) => p.userId).filter((u): u is string => !!u))];
    const owners = ownerIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: ownerIds } } })
      : [];
    const ownerById = new Map(owners.map((o) => [o.id, o]));

    const rows: ProductImageGroupRow[] = pageProducts.map((p) => {
      const rawFiles = filesByProduct.get(String(p.id)) ?? [];
      const photos: ProductImageGroupPhoto[] = rawFiles.map((r) => this.mapGalleryFile(r));
      const owner = p.userId ? ownerById.get(p.userId) : undefined;
      return {
        product: {
          id: p.id,
          name: p.productName,
          slug: p.slug,
          status: p.status,
          createdAt: toIso(p.createdAt) ?? '',
          updatedAt: toIso(p.updatedAt) ?? '',
        },
        owner: owner
          ? {
              id: owner.id,
              userName: owner.userName,
              name: `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim(),
              phone: owner.phone,
              bUserName: owner.bUserName,
            }
          : null,
        photos,
        photoCount: photos.length,
        totalSize: photos.reduce((s, ph) => s + ph.size, 0),
      };
    });

    return {
      rows,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      summary: await summary,
    };
  }

  /** File خام گالری → DTO عکس (بدون محصول/مالک — در حالت گروهی روی ردیف هست) */
  private mapGalleryFile(r: Record<string, unknown>): ProductImageGroupPhoto {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    return {
      id: toId(r._id),
      url: String(r.url ?? ''),
      thumbUrl: (r.thumb_url as string) ?? null,
      size: Number(r.size ?? 0),
      mimeType: String(r.mime_type ?? ''),
      name: String(r.name ?? ''),
      createdAt: toIso(r.created_at) ?? '',
      updatedAt: toIso(r.updated_at) ?? '',
      width: num(meta.width),
      height: num(meta.height),
      source: meta.importedFrom === 'buskool' ? 'buskool' : 'native',
      importedFrom: typeof meta.importedFrom === 'string' ? meta.importedFrom : null,
      originalUrl: typeof meta.originalUrl === 'string' ? meta.originalUrl : null,
      replacedAt: typeof meta.replacedAt === 'string' ? meta.replacedAt : null,
    };
  }

  /**
   * idهای آگهی‌های منطبق با جستجو + بازهٔ تاریخ — null یعنی بدون محدودیت.
   * (همان منطق حالت تخت، جدا شد تا هر دو حالت از یک منبع بخرند)
   */
  private async productIdsFromTextFilters(query: ProductImagesQueryDto): Promise<string[] | null> {
    const createdRange = mongoDateRange(query.createdFrom, query.createdTo);
    const updatedRange = mongoDateRange(query.updatedFrom, query.updatedTo);
    const q = query.q?.trim();
    if (!createdRange && !updatedRange && !q) return null;

    let rangeIds: string[] | null = null;
    if (createdRange || updatedRange) {
      const between = (from?: string, to?: string) => ({
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      });
      const inRange = await this.prisma.product.findMany({
        where: {
          ...(createdRange ? { createdAt: between(query.createdFrom, query.createdTo) } : {}),
          ...(updatedRange ? { updatedAt: between(query.updatedFrom, query.updatedTo) } : {}),
        },
        select: { id: true },
        take: 50_000,
      });
      rangeIds = inRange.map((p) => String(p.id));
      if (rangeIds.length === 0) return [];
    }

    if (q) {
      const contains = { contains: q, mode: 'insensitive' as const };
      const prodOr: Prisma.ProductWhereInput[] = [{ productName: contains }, { slug: contains }];
      if (/^\d+$/.test(q)) prodOr.push({ id: Number(q) });
      const [byName, owners] = await Promise.all([
        this.prisma.product.findMany({ where: { OR: prodOr }, select: { id: true }, take: 5000 }),
        this.prisma.user.findMany({
          where: {
            OR: [
              { phone: contains },
              { userName: contains },
              { firstName: contains },
              { lastName: contains },
              { bUserName: contains },
            ],
          },
          select: { id: true },
          take: 2000,
        }),
      ]);
      const ids = new Set(byName.map((p) => p.id));
      if (owners.length > 0) {
        const owned = await this.prisma.product.findMany({
          where: { userId: { in: owners.map((u) => u.id) } },
          select: { id: true },
          take: 5000,
        });
        for (const p of owned) ids.add(p.id);
      }
      if (ids.size === 0) return [];
      const qIds = [...ids].map(String);
      return rangeIds != null ? qIds.filter((x) => rangeIds!.includes(x)) : qIds;
    }
    return rangeIds;
  }

  /** آمار کلی تصاویر — کارت‌های بالای آلبوم */
  async imagesSummary(): Promise<ProductImagesSummary> {
    const agg = (await this.prisma.$runCommandRaw({
      aggregate: 'File',
      pipeline: [
        { $match: { related_model: 'Product', field_key: 'gallery' } },
        {
          $facet: {
            total: [{ $count: 'n' }],
            buskool: [{ $match: { 'metadata.importedFrom': 'buskool' } }, { $count: 'n' }],
            replaced: [{ $match: { 'metadata.replacedAt': { $ne: null } } }, { $count: 'n' }],
            buskoolRemaining: [
              { $match: { 'metadata.importedFrom': 'buskool', 'metadata.replacedAt': null } },
              { $count: 'n' },
            ],
          },
        },
      ] as unknown as Prisma.InputJsonObject[],
      cursor: {},
    })) as unknown as { cursor?: { firstBatch?: Record<string, unknown>[] } };
    const f = agg?.cursor?.firstBatch?.[0] ?? {};
    const cnt = (key: string): number => Number(((f[key] ?? []) as { n?: number }[])[0]?.n ?? 0);
    const total = cnt('total');
    const buskool = cnt('buskool');
    return {
      total,
      buskool,
      native: total - buskool,
      replaced: cnt('replaced'),
      buskoolRemaining: cnt('buskoolRemaining'),
    };
  }

  // ─── کارخانه‌های lookup (هر بار آبجکت تازه) ────────────────────────────────

  /** ویرایش‌های واقعی فروشنده روی آگهی — action=edit فقط */
  private editsLookup() {
    return {
      $lookup: {
        from: 'ProductEditHistory',
        let: { pid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$product_id', '$$pid'] }, action: 'edit' } },
          { $project: { created_at: 1 } },
        ],
        as: '_edits',
      },
    };
  }

  /** فایل‌های گالری آگهی — اولین عکس = کاور (مرتب با created_at صعودی) */
  private photosLookup() {
    return {
      $lookup: {
        from: 'File',
        let: { pid: { $toString: '$_id' } },
        pipeline: [
          { $match: { related_model: 'Product', field_key: 'gallery' } },
          { $match: { $expr: { $eq: ['$related_id', '$$pid'] } } },
          { $project: { url: 1, thumb_url: 1, created_at: 1 } },
          { $sort: { created_at: 1 } },
          { $limit: 8 },
        ],
        as: '_photos',
      },
    };
  }
}
