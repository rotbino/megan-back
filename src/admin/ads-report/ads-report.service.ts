import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.module';
import { CacheService } from '../../common/cache/cache.module';
import { CategoriesService } from '../../categories/categories.service';
import { LocationsService } from '../../locations/locations.service';
import { UploadsService } from '../../uploads/uploads.service';
import { AppError } from '../../common/errors/app-error';
import { BUSKOL_TO_V2, BUSKOL_NAME_TO_V2 } from './buskol-map.generated';
import {
  TAXONOMY_V2_ROOTS,
  effectiveAttrs,
  findTaxonomyNode,
  flattenTaxonomy,
  type TaxonomyAttr,
  type TaxonomyNode,
} from './taxonomy-v2';
import type { GetAdsReportDto, GetCatalogListDto } from './dto';

/** نود درخت پاسخ getTree — با شمار آگهی زیر همان گره */
export interface TaxonomyCountNode {
  key: string;
  name: string;
  icon?: string;
  count: number;
  attrs?: TaxonomyAttr[];
  children?: TaxonomyCountNode[];
}

/** ردیف گزارش — عین AdminProductRow + مسیر v2 + اتریبیوت‌های استخراج‌شده */
export interface AdsReportRow {
  id: number;
  product_name: string;
  status: string;
  /** مسیر تاکسونومی v2 مثل ['کشاورزی و باغبانی','حبوبات','نخود'] — null = نگاشت‌نشده */
  v2_path: string[] | null;
  v2_key: string | null;
  /** مسیر باسکول «خشکبار ← پسته» — همیشه کنار v2 می‌ماند (دو-دسته‌بندی دائمی) */
  buskol_path: string;
  province_name: string;
  city_name: string;
  seller: { id: string; user_name: string; full_name: string; phone: string; is_verified: boolean };
  stock: number;
  min_sale_amount: number;
  min_sale_price: number;
  unit: string;
  is_ladder: boolean;
  view_count: number;
  photo: string | null;
  created_at: Date;
  updated_at: Date;
  /** اتریبیوت‌های استخراج‌شده از نام آزاد — فقط برای گره‌های دارای تعریف attrs */
  resolved_attrs?: Record<string, string>;
}

/** ردیف عمومی کاتالوگ v2 — بدون تلفن/وضعیت ادمین (صفحهٔ /product-filter) */
export interface PublicCatalogRow {
  id: number;
  product_name: string;
  /** مسیر تاکسونومی v2 مثل ['کشاورزی و باغبانی','حبوبات','نخود'] */
  v2_path: string[];
  v2_key: string;
  province_name: string;
  city_name: string;
  seller: { user_name: string; full_name: string; is_verified: boolean };
  stock: number;
  min_sale_amount: number;
  min_sale_price: number;
  unit: string;
  is_ladder: boolean;
  view_count: number;
  photo: string | null;
  updated_at: Date;
  resolved_attrs?: Record<string, string>;
}

/** گره انتخابی معتبر گزارش — 'all'، 'unmapped' یا کلید v2 */
type NodeSelection = 'all' | 'unmapped' | { key: string };

// ─── نرمال‌سازی فارسی + توکنایز — پایهٔ تطبیق نام آزاد ────────────────────────

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeFa(input: string): string {
  return input
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TOKEN_SPLIT = /[^\u0600-\u06FF0-9a-zA-Z]+/;

/** آیا نام با نام‌مترادف تطبیق می‌کند؟ تک‌واژه → تطبیق توکن؛ چندواژه → زیررشته */
function matchesAlias(normalizedName: string, tokens: Set<string>, alias: string): boolean {
  const a = normalizeFa(alias);
  if (!a) return false;
  if (a.includes(' ')) return normalizedName.includes(a);
  return tokens.has(a);
}

/** اتریبیوت‌های یک نام — اولین گزینهٔ منطبق هر ویژگی */
export function resolveAttrsForName(
  name: string,
  attrs: TaxonomyAttr[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!attrs.length) return out;
  const normalized = normalizeFa(name);
  const tokens = new Set(normalized.split(TOKEN_SPLIT).filter(Boolean));
  for (const attr of attrs) {
    for (const opt of attr.options) {
      if (opt.match.some((alias) => matchesAlias(normalized, tokens, alias))) {
        out[attr.key] = opt.label;
        break;
      }
    }
  }
  return out;
}

/** فیلتر اتریبیوتی — نام باید از هر ویژگیِ انتخاب‌شده حداقل یک گزینه بزند */
function passesAttrFilter(
  name: string,
  attrs: TaxonomyAttr[],
  selection: Record<string, Set<string>>,
): boolean {
  const normalized = normalizeFa(name);
  const tokens = new Set(normalized.split(TOKEN_SPLIT).filter(Boolean));
  for (const attr of attrs) {
    const wanted = selection[attr.key];
    if (!wanted || wanted.size === 0) continue;
    const hit = attr.options.some(
      (opt) => wanted.has(opt.label) && opt.match.some((alias) => matchesAlias(normalized, tokens, alias)),
    );
    if (!hit) return false;
  }
  return true;
}

/**
 * گزارش آگهی‌ها روی تاکسونومی v2 — «صفحهٔ مهاجرت» ادمین.
 *
 * سایت عمومی همچنان روی دستهٔ باسکول است؛ این سرویس آگهی‌ها را در لحظهٔ
 * خواندن از شناسهٔ باسکول به کلید v2 می‌برد (جدول نگاشت استاتیک —
 * scripts/gen-taxonomy-map.ts). وقتی مالک سوییچ عمومی را اعلام کند، همین
 * جدول مبنای متریالایز فیلد روی Product خواهد شد.
 */
@Injectable()
export class AdsReportService {
  /** کلید v2 → همهٔ idهای باسکول زیر همان گره (پرشده از نگاشت استاتیک) */
  private readonly keyToBuskolIds = new Map<string, number[]>();
  /** همهٔ idهای دارای نگاشت — برای گره 'unmapped' */
  private readonly mappedBuskolIds = new Set<number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly categories: CategoriesService,
    private readonly locations: LocationsService,
    private readonly uploads: UploadsService,
  ) {
    // پیش‌محاسبهٔ معکوس نگاشت — کلید هر دستهٔ باسکول روی خودش و همهٔ اجدادش
    for (const [bId, key] of Object.entries(BUSKOL_TO_V2)) {
      const id = Number(bId);
      this.mappedBuskolIds.add(id);
      const chain = key.split('.');
      for (let i = 1; i <= chain.length; i++) {
        const k = chain.slice(0, i).join('.');
        const list = this.keyToBuskolIds.get(k) ?? [];
        list.push(id);
        this.keyToBuskolIds.set(k, list);
      }
    }
  }

  // ─── درخت + شمار آگهی‌ها ────────────────────────────────────────────────────

  /** POST /admin/ads-report/getTree — درخت v2 با شمار آگهی هر گره (کش ۶۰ث) */
  async getTree() {
    return this.cache.wrap(
      'ads-report:tree:v2',
      { ttlMs: 60_000 },
      async (): Promise<{
        totalProducts: number;
        mapped: number;
        unmapped: number;
        roots: TaxonomyCountNode[];
      }> => {
        const bySub = await this.prisma.product.groupBy({
          by: ['subCategoryId'],
          _count: { _all: true },
        });

        const counts = new Map<string, number>();
        let mapped = 0;
        let total = 0;
        for (const g of bySub) {
          const c = g._count._all;
          total += c;
          const key = this.resolveKey(g.subCategoryId);
          if (!key) continue;
          mapped += c;
          const chain = key.split('.');
          for (let i = 1; i <= chain.length; i++) {
            const k = chain.slice(0, i).join('.');
            counts.set(k, (counts.get(k) ?? 0) + c);
          }
        }

        const build = (nodes: TaxonomyNode[]): TaxonomyCountNode[] =>
          nodes.map((n) => {
            const out: TaxonomyCountNode = {
              key: n.key,
              name: n.name,
              count: counts.get(n.key) ?? 0,
              ...(n.icon ? { icon: n.icon } : {}),
              ...(n.attrs?.length ? { attrs: n.attrs } : {}),
            };
            if (n.children?.length) out.children = build(n.children);
            return out;
          });

        return {
          totalProducts: total,
          mapped,
          unmapped: total - mapped,
          roots: build(TAXONOMY_V2_ROOTS),
        };
      },
    );
  }

  // ─── لیست آگهی‌ها با فیلترهای گزارش ────────────────────────────────────────

  /** POST /admin/ads-report/getReport */
  async getReport(dto: GetAdsReportDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(60, Math.max(1, dto.perPage ?? 24));
    const selection = this.parseSelection(dto.nodeKey);
    const nodeKey = typeof selection === 'string' ? null : selection?.key ?? null;

    const base: Prisma.ProductWhereInput[] = [
      ...(dto.provinceId ? [{ provinceId: dto.provinceId }] : []),
      ...(dto.cityId ? [{ cityId: dto.cityId }] : []),
    ];
    const s = (dto.search ?? '').trim();
    if (s) base.push({ productName: { contains: s } });

    // شرط گره — همه / نگاشت‌نشده / زیردرخت v2
    if (selection === 'unmapped') {
      base.push({ subCategoryId: { notIn: [...this.mappedBuskolIds] } });
    } else if (nodeKey) {
      const ids = this.keyToBuskolIds.get(nodeKey) ?? [];
      if (ids.length === 0) return this.emptyList(page, perPage, []);
      base.push({ OR: [{ subCategoryId: { in: ids } }, { categoryId: { in: ids } }] });
    }

    // اتریبیوت‌های مؤثر گره + پاک‌سازی انتخاب کاربر
    const attrs = nodeKey ? effectiveAttrs(nodeKey) : [];
    const attrSelection = this.sanitizeAttrSelection(attrs, dto.attrs);
    const attrActive = Object.keys(attrSelection).length > 0;

    let total: number;
    let rows: Awaited<ReturnType<PrismaService['product']['findMany']>>;
    let counts: Record<string, number>;

    if (attrActive) {
      // نام‌محور — نامزدها را می‌خوانیم، در حافظه تطبیق می‌دهیم، بعد صفحه می‌بندیم
      const candidates = await this.prisma.product.findMany({
        where: { AND: base },
        select: { id: true, productName: true, status: true },
      });
      const matched = candidates.filter((c) =>
        passesAttrFilter(c.productName, attrs, attrSelection),
      );
      total = matched.length;

      counts = { pending: 0, confirmed: 0, rejected: 0, deleted: 0, all: matched.length };
      for (const m of matched) counts[m.status] = (counts[m.status] ?? 0) + 1;

      const pageIds = matched
        .slice((page - 1) * perPage, page * perPage)
        .map((m) => m.id);
      rows = pageIds.length
        ? await this.prisma.product.findMany({ where: { id: { in: pageIds } } })
        : [];
      // ترتیب صفحه حفظ شود
      const order = new Map(pageIds.map((id, i) => [id, i]));
      rows = rows
        .slice()
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    } else {
      const listWhere: Prisma.ProductWhereInput = base.length ? { AND: base } : {};
      const countsWhere: Prisma.ProductWhereInput = {
        ...(dto.provinceId ? { provinceId: dto.provinceId } : {}),
        ...(dto.cityId ? { cityId: dto.cityId } : {}),
        ...(s ? { productName: { contains: s } } : {}),
        ...(selection === 'unmapped'
          ? { subCategoryId: { notIn: [...this.mappedBuskolIds] } }
          : nodeKey
            ? {
                OR: [
                  { subCategoryId: { in: this.keyToBuskolIds.get(nodeKey) ?? [] } },
                  { categoryId: { in: this.keyToBuskolIds.get(nodeKey) ?? [] } },
                ],
              }
            : {}),
      };

      const byStatus = await this.prisma.product.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: countsWhere,
      });
      counts = { pending: 0, confirmed: 0, rejected: 0, deleted: 0, all: 0 };
      for (const g of byStatus) counts[g.status] = g._count._all;
      counts.all =
        (counts.pending ?? 0) + (counts.confirmed ?? 0) + (counts.rejected ?? 0) + (counts.deleted ?? 0);

      const where: Prisma.ProductWhereInput = { AND: [...base, ...(dto.status ? [{ status: dto.status }] : [])] };
      [total, rows] = await Promise.all([
        this.prisma.product.count({ where }),
        this.prisma.product.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip: (page - 1) * perPage,
          take: perPage,
        }),
      ]);
    }

    return {
      total,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      counts,
      attrs,
      items: await this.toRows(rows, attrs.length > 0),
    };
  }

  // ─── لیست عمومی کاتالوگ v2 — صفحهٔ /product-filter ─────────────────────────

  /** POST /catalog/v2/getList — فقط confirmed، بدون تلفن، سورت جدیدترین/قیمت */
  async getPublicList(dto: GetCatalogListDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(48, Math.max(1, dto.perPage ?? 24));

    // کلید v2 معتبر یا هیچ — «unmapped» ادمینی اینجا معنا ندارد
    const nodeKey =
      dto.nodeKey && dto.nodeKey !== 'all' && findTaxonomyNode(dto.nodeKey)
        ? dto.nodeKey
        : null;

    const priceSort = dto.sort === 'price-asc' || dto.sort === 'price-desc';
    const base: Prisma.ProductWhereInput[] = [
      { status: 'confirmed' },
      ...(priceSort ? [{ minSalePrice: { gt: 0 } }] : []),
      ...(dto.provinceId ? [{ provinceId: dto.provinceId }] : []),
      ...(dto.cityId ? [{ cityId: dto.cityId }] : []),
    ];
    const s = (dto.search ?? '').trim();
    if (s) base.push({ productName: { contains: s } });

    if (nodeKey) {
      const ids = this.keyToBuskolIds.get(nodeKey) ?? [];
      if (ids.length === 0) return this.emptyPublicList(page, perPage, []);
      base.push({ OR: [{ subCategoryId: { in: ids } }, { categoryId: { in: ids } }] });
    }

    const attrs = nodeKey ? effectiveAttrs(nodeKey) : [];
    const attrSelection = this.sanitizeAttrSelection(attrs, dto.attrs);
    const attrActive = Object.keys(attrSelection).length > 0;

    let total: number;
    let rows: Awaited<ReturnType<PrismaService['product']['findMany']>>;

    if (attrActive) {
      // نام‌محور — مثل گزارش ادمین: نامزدها → تطبیق در حافظه → صفحه‌بندی
      // (سورت قیمت در حالت اتریبیوتی فعال نیست؛ ترتیب = آخرین به‌روزرسانی)
      const candidates = await this.prisma.product.findMany({
        where: { AND: base },
        select: { id: true, productName: true },
      });
      const matched = candidates.filter((c) =>
        passesAttrFilter(c.productName, attrs, attrSelection),
      );
      total = matched.length;
      const pageIds = matched
        .slice((page - 1) * perPage, page * perPage)
        .map((m) => m.id);
      rows = pageIds.length
        ? await this.prisma.product.findMany({ where: { id: { in: pageIds } } })
        : [];
      const order = new Map(pageIds.map((id, i) => [id, i]));
      rows = rows
        .slice()
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    } else {
      const orderBy: Prisma.ProductOrderByWithRelationInput[] =
        dto.sort === 'price-asc'
          ? [{ minSalePrice: 'asc' }, { updatedAt: 'desc' }]
          : dto.sort === 'price-desc'
            ? [{ minSalePrice: 'desc' }, { updatedAt: 'desc' }]
            : [{ isLadder: 'desc' }, { updatedAt: 'desc' }];
      const where: Prisma.ProductWhereInput = { AND: base };
      [total, rows] = await Promise.all([
        this.prisma.product.count({ where }),
        this.prisma.product.findMany({
          where,
          orderBy,
          skip: (page - 1) * perPage,
          take: perPage,
        }),
      ]);
    }

    return {
      total,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      attrs,
      items: await this.toPublicRows(rows, attrs.length > 0),
    };
  }

  // ─── داخلی ─────────────────────────────────────────────────────────────────

  /** resolve یک دستهٔ باسکول → کلید v2 (id، بعد نام — مقاوم در برابر ایمپورت‌های تازه) */
  private resolveKey(buskolId: number, name?: string): string | null {
    return BUSKOL_TO_V2[buskolId] ?? (name ? BUSKOL_NAME_TO_V2[normalizeFa(name)] ?? null : null);
  }

  private parseSelection(nodeKey?: string): NodeSelection {
    if (!nodeKey || nodeKey === 'all') return 'all';
    if (nodeKey === 'unmapped') return 'unmapped';
    if (!findTaxonomyNode(nodeKey)) {
      throw AppError.notFound('گره دسته‌بندی جدید یافت نشد.');
    }
    return { key: nodeKey };
  }

  /** انتخاب اتریبیوت کاربر را به گزینه‌های واقعی تاکسونومی محدود می‌کند */
  private sanitizeAttrSelection(
    attrs: TaxonomyAttr[],
    raw?: Record<string, string[]>,
  ): Record<string, Set<string>> {
    const out: Record<string, Set<string>> = {};
    if (!raw || !attrs.length) return out;
    for (const attr of attrs) {
      const wanted = raw[attr.key];
      if (!Array.isArray(wanted)) continue;
      const labels = new Set(attr.options.map((o) => o.label));
      const picked = wanted.filter((w) => labels.has(w));
      if (picked.length) out[attr.key] = new Set(picked);
    }
    return out;
  }

  private emptyList(page: number, perPage: number, attrs: TaxonomyAttr[]) {
    return {
      total: 0,
      page,
      perPage,
      pageCount: 1,
      counts: { pending: 0, confirmed: 0, rejected: 0, deleted: 0, all: 0 },
      attrs,
      items: [] as AdsReportRow[],
    };
  }

  private emptyPublicList(page: number, perPage: number, attrs: TaxonomyAttr[]) {
    return {
      total: 0,
      page,
      perPage,
      pageCount: 1,
      attrs,
      items: [] as PublicCatalogRow[],
    };
  }

  /** نسخهٔ عمومی toRows — بدون تلفن/وضعیت/مسیر ادمینی */
  private async toPublicRows(
    rows: Array<{
      id: number; productName: string; status: string; categoryId: number; subCategoryId: number;
      provinceId: number; cityId: number; userId: string; stock: number; minSaleAmount: number;
      minSalePrice: number; unit: string; isLadder: boolean; viewCount: number;
      createdAt: Date; updatedAt: Date;
    }>,
    withAttrs: boolean,
  ): Promise<PublicCatalogRow[]> {
    const report = await this.toRows(rows, withAttrs);
    return report.map((r) => ({
      id: r.id,
      product_name: r.product_name,
      v2_path: r.v2_path ?? [],
      v2_key: r.v2_key ?? '',
      province_name: r.province_name,
      city_name: r.city_name,
      seller: {
        user_name: r.seller.user_name,
        full_name: r.seller.full_name,
        is_verified: r.seller.is_verified,
      },
      stock: r.stock,
      min_sale_amount: r.min_sale_amount,
      min_sale_price: r.min_sale_price,
      unit: r.unit,
      is_ladder: r.is_ladder,
      view_count: r.view_count,
      photo: r.photo,
      updated_at: r.updated_at,
      ...(r.resolved_attrs ? { resolved_attrs: r.resolved_attrs } : {}),
    }));
  }

  /** join نام‌ها + گالری + مسیر v2 — گروهی، نه به‌ازای هر ردیف */
  private async toRows(
    rows: Array<{
      id: number; productName: string; status: string; categoryId: number; subCategoryId: number;
      provinceId: number; cityId: number; userId: string; stock: number; minSaleAmount: number;
      minSalePrice: number; unit: string; isLadder: boolean; viewCount: number;
      createdAt: Date; updatedAt: Date;
    }>,
    withAttrs: boolean,
  ): Promise<AdsReportRow[]> {
    if (rows.length === 0) return [];

    const [gallery, userRows, catMap, locNames] = await Promise.all([
      this.uploads.galleryMap(rows.map((r) => r.id)),
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
        select: { id: true, userName: true, phone: true, isVerified: true, firstName: true, lastName: true },
      }),
      this.categories.getNameMap(),
      this.locations.getNames(
        [...new Set(rows.map((r) => r.provinceId))],
        [...new Set(rows.map((r) => r.cityId))],
      ),
    ]);

    const users = new Map(userRows.map((u) => [u.id, u]));
    const UNKNOWN = '—';

    return rows.map((p) => {
      const seller = users.get(p.userId);
      const photo = gallery.get(p.id)?.[0];
      const v2Key = this.resolveKey(p.subCategoryId) ?? this.resolveKey(p.categoryId);
      const v2Path = v2Key
        ? flattenTaxonomy()
            .filter((n) => v2Key === n.key || v2Key.startsWith(`${n.key}.`))
            .map((n) => n.name)
        : null;
      const catName = catMap.get(p.categoryId)?.category_name ?? UNKNOWN;
      const subName = catMap.get(p.subCategoryId)?.category_name ?? UNKNOWN;

      return {
        id: p.id,
        product_name: p.productName,
        status: p.status,
        v2_path: v2Path,
        v2_key: v2Key,
        buskol_path: `${catName} ← ${subName}`,
        province_name: locNames.provinces.get(p.provinceId) ?? UNKNOWN,
        city_name: locNames.cities.get(p.cityId) ?? UNKNOWN,
        seller: {
          id: p.userId,
          user_name: seller?.userName ?? UNKNOWN,
          full_name: [seller?.firstName, seller?.lastName].filter(Boolean).join(' ').trim() || seller?.userName || '',
          phone: seller?.phone ?? '',
          is_verified: seller?.isVerified ?? false,
        },
        stock: p.stock,
        min_sale_amount: p.minSaleAmount,
        min_sale_price: p.minSalePrice,
        unit: p.unit,
        is_ladder: p.isLadder,
        view_count: p.viewCount,
        photo: photo?.thumbUrl ?? photo?.url ?? null,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
        ...(withAttrs && v2Key
          ? { resolved_attrs: resolveAttrsForName(p.productName, effectiveAttrs(v2Key)) }
          : {}),
      };
    });
  }
}
