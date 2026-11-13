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
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
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
  product: { id: number; name: string; slug: string; status: string } | null;
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

  async listImages(query: ProductImagesQueryDto): Promise<ProductImagesList> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(60, Math.max(4, query.pageSize ?? 20));
    const dir = query.sort === 'oldest' ? 1 : -1;
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
      filter.related_id = { $in: [...ids].map(String) };
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
          { $sort: { created_at: dir, _id: dir } },
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
              product: { _id: 1, product_name: 1, slug: 1, status: 1 },
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
