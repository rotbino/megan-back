import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.module';
import { CacheService, TTL } from '../../common/cache/cache.module';
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
  taxonomyPath,
  type TaxonomyAttr,
  type TaxonomyNode,
} from './taxonomy-v2';
import type { GetAdsReportDto, GetCatalogListDto } from './dto';
import { PAYMENT_OPTIONS, SELLER_TYPE_OPTIONS } from './dto';

/** ── (۲۸-۱۱ دور ۵) شرایط معاملهٔ عمده — فیلترهای هم‌مقیاس خریدار عمده ──
 *  همان زبان فیلتر باسکول: نوع فروشنده (کشاورز/تولیدکننده/…) + نحوهٔ پرداخت
 *  (نقد/چک سررسید/اعتباری) + سوییچ‌های «دارای گواهی/آنالیز» و «ارسال‌دار
 *  (باربری)». آگهی‌های قدیمیِ بدون مقدار = «نامشخص» — فیلتر فقط روی مقدار‌دارها
 *  اعمال می‌شود و «نامشخص» هیچ سبدی را نمی‌نشیند. */
const SELLER_TYPES = new Set<string>(SELLER_TYPE_OPTIONS);
const PAYMENTS = new Set<string>(PAYMENT_OPTIONS);

/** پاک‌سازی انتخاب کاربر — فقط مقادیر مجاز فیلترها */
function sanitizeTrade(
  dto: GetCatalogListDto,
): { sellerTypes: string[]; payments: string[]; analysisOnly: boolean; shippingOnly: boolean } {
  return {
    sellerTypes: (dto.sellerTypes ?? []).filter((s) => SELLER_TYPES.has(s)),
    payments: (dto.payments ?? []).filter((p) => PAYMENTS.has(p)),
    analysisOnly: dto.analysisOnly === true,
    shippingOnly: dto.shippingOnly === true,
  };
}

/** شرط‌های SQL شرایط معامله — برای مسیر خالص؛ هر گزینه = شرط مستقل */
function tradeConds(
  t: { sellerTypes: string[]; payments: string[]; analysisOnly: boolean; shippingOnly: boolean },
): Prisma.ProductWhereInput[] {
  return [
    ...(t.sellerTypes.length ? [{ sellerType: { in: t.sellerTypes } }] : []),
    ...(t.payments.length ? [{ paymentTypes: { hasSome: t.payments } }] : []),
    ...(t.analysisOnly ? [{ hasAnalysis: true }] : []),
    ...(t.shippingOnly ? [{ shipping: true }] : []),
  ];
}

/** نود درخت پاسخ getTree — با شمار آگهی زیر همان گره */
export interface TaxonomyCountNode {
  key: string;
  name: string;
  icon?: string;
  /** مثال «نوع کالا» — فقط برگ‌ها (۲۷-۱۱)؛ پلیس‌هولدر فرم‌های فرانت */
  example?: string;
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
  /** مسیر پاسکال «خشکبار ← پسته» — همیشه کنار v2 می‌ماند (دو-دسته‌بندی دائمی) */
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
  /** (۲۸-۱۱ دور ۵) شرایط معامله — بج کارت */
  seller_type?: string | null;
  payment_types?: string[];
  has_analysis?: boolean;
  shipping?: boolean;
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
  /** (۲۸-۱۱ دور ۵) شرایط معامله — بج کارت برای اعتماد خریدار */
  seller_type?: string | null;
  payment_types?: string[];
  has_analysis?: boolean;
  shipping?: boolean;
}

/** (۲۸-۱۱ دور ۵) شمارش فیلترهای شرایط معامله — کنار هر گزینه، مثل بقیهٔ فاست‌ها */
export interface PublicCatalogTradeFacets {
  /** نوع فروشنده → شمار آگهی (بقیهٔ فیلترها به‌جز خودش)؛ «نامشخص» شمرده نمی‌شود */
  sellerTypes: Record<string, number>;
  /** نحوهٔ پرداخت → شمار آگهی که آن را می‌پذیرد */
  payments: Record<string, number>;
  /** شمار آگهی‌های دارای گواهی/آنالیز کیفیت */
  analysis: number;
  /** شمار آگهی‌های ارسال‌دار (باربری) */
  shipping: number;
}

/** (۲۸-۱۱ طرح تامینان) شمارش «چند آگهی با این گزینه می‌ماند» — کنار هر گزینهٔ
 *  فیلتر نمایش می‌آید؛ شمار صفر = گزینهٔ خاموش. شمار استان/شهر با بقیهٔ
 *  فیلترها به‌جز مکان محاسبه می‌شود (کاربر ببییند بازار در کجاست). */
export interface PublicCatalogFacets {
  provinces: { id: number; name: string; count: number }[];
  cities: { id: number; name: string; count: number }[];
  /** attrKey → برچسب گزینه → شمار آگهی (بقیهٔ فیلترها + همین گزینه) */
  attrs: Record<string, Record<string, number>>;
  /** بازهٔ واقعی قیمت/حداقل‌سفارش در گرهٔ فعلی — پلیس‌هولدر فرم بازه */
  price: { min: number | null; max: number | null };
  moq: { min: number | null; max: number | null };
  /** (۲۸-۱۱ دور ۵) شرایط معامله */
  trade: PublicCatalogTradeFacets;
}

/** واحد فروش پرتکرار گره — برچسب واحد در فیلتر حجم خرید از اینجا می‌آید؛
 *  برای «همهٔ دسته‌ها» null است (واحد یکتا ندارد) */
export interface PublicCatalogUnitStats {
  unit: string;
  count: number;
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

/** اتریبیوت‌های واقعی یک آگهی — نام‌محور + ویژگی‌های دستیِ فرم (دور ۴):
 *  فروشنده در پنل ویژگی‌های کالا را از اتریبیوت‌های دسته‌اش انتخاب می‌کند
 *  (features با key = کلید یا برچسب ویژگی، value = برچسب گزینه/نام‌مترادف)؛
 *  دستی بر نام‌محور مقدم است؛ مقدار دستی فقط وقتی پذیرفته می‌شود که به یک
 *  گزینهٔ معتبر همان ویژگی بخورد — گزینهٔ «سایر/بدون برند» هم مثل بقیه. */
export function resolveProductAttrs(
  productName: string,
  features: unknown,
  attrs: TaxonomyAttr[],
): Record<string, string> {
  const out = resolveAttrsForName(productName, attrs);
  if (!attrs.length || !Array.isArray(features)) return out;
  for (const f of features) {
    if (!f || typeof f.key !== 'string' || typeof f.value !== 'string') continue;
    const value = f.value.trim();
    if (!value) continue;
    const attr = attrs.find((a) => a.key === f.key || a.label === f.key);
    if (!attr) continue;
    const opt = attr.options.find(
      (o) => o.label === value || o.match.includes(value),
    );
    if (opt) out[attr.key] = opt.label;
  }
  return out;
}

/** فیلتر اتریبیوتی — اتریبیوت‌های واقعی (نام + ویژگی‌های دستی — دور ۴) باید
 *  از هر ویژگیِ انتخاب‌شده حداقل یک گزینه بزند */
function passesAttrFilter(
  name: string,
  attrs: TaxonomyAttr[],
  selection: Record<string, Set<string>>,
  features: unknown = [],
): boolean {
  const resolved = resolveProductAttrs(name, features, attrs);
  for (const attr of attrs) {
    const wanted = selection[attr.key];
    if (!wanted || wanted.size === 0) continue;
    if (!wanted.has(resolved[attr.key] ?? '')) return false;
  }
  return true;
}

/**
 * گزارش آگهی‌ها روی تاکسونومی v2 — «صفحهٔ مهاجرت» ادمین.
 *
 * سایت عمومی همچنان روی دستهٔ پاسکال است؛ این سرویس آگهی‌ها را در لحظهٔ
 * خواندن از شناسهٔ پاسکال به کلید v2 می‌برد (جدول نگاشت استاتیک —
 * scripts/gen-taxonomy-map.ts). وقتی مالک سوییچ عمومی را اعلام کند، همین
 * جدول مبنای متریالایز فیلد روی Product خواهد شد.
 */
@Injectable()
export class AdsReportService {
  /** کلید v2 → همهٔ idهای پاسکال زیر همان گره (پرشده از نگاشت استاتیک) */
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
    // پیش‌محاسبهٔ معکوس نگاشت — کلید هر دستهٔ پاسکال روی خودش و همهٔ اجدادش
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
              ...(n.example ? { example: n.example } : {}),
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
      // نامزدها (با features فرم فروشنده) خوانده می‌شوند، در حافظه تطبیق
      // می‌شوند، بعد صفحه بسته می‌شود
      const candidates = await this.prisma.product.findMany({
        where: { AND: base },
        select: { id: true, productName: true, status: true, features: true },
      });
      const matched = candidates.filter((c) =>
        passesAttrFilter(c.productName, attrs, attrSelection, c.features),
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

  /**
   * POST /catalog/v2/getList — فقط confirmed، بدون تلفن؛ (۲۸-۱۱ طرح تامینان)
   * فیلترها: گره + استان/شهر + جستجو + اتریبیوت‌ها + بازهٔ قیمت + بازهٔ حجم خرید؛
   * سورت: مرتبط‌ترین (پیش‌فرض — امتیاز تطابق) | جدیدترین | ارزان‌ترین | گران‌ترین |
   * کمترین حداقل خرید | بیشترین موجودی.
   *
   * «مرتبط‌ترین» (۲۸-۱۱ دور ۳): امتیاز تطابق سمت سرور — آگهی‌های شهر خودِ کاربر
   * واردشده بالاتر از هم‌استان، هم‌استان بالاتر از بقیه؛ در گره‌های اتریبیوت‌دار
   * کامل بودن ویژگی‌ها (برخورد نام با ویژگی‌های تعریف‌شده) هم امتیاز دارد؛
   * تای‌بریک: نردبان بعد تازگی. امتیاز هرگز به کاربر نمایش نمی‌یابد. مهمان
   * (بدون توکن/شهر) = همان newest.
   *
   * پاسخ افزوده‌های صفحهٔ فیلتر پیشرفته را هم می‌آورد:
   *  • facets — شمارش کنار هر گزینه (استان/شهر/اتریبیوت) + بازهٔ واقعی قیمت/حجم؛
   *  • unit — واحد پرتکرار گره برای برچسب‌های فیلتر حجم؛
   *  • node — نام و مسیر گرهٔ انتخابی (breadcrumbs فرانت).
   *
   * دو مسیر اجرا: گره‌های دارای اتریبیوت (۱۳+ برگ/خانوادهٔ فعلی) نام‌محورند —
   * نامزدها یک‌بار خوانده می‌شوند، همهٔ فیلترها + فاست‌ها در حافظه؛ بقیهٔ گره‌ها
   * خالص SQL می‌مانند (۶۲هزار آگهی «همهٔ دسته‌ها» را به حافظه نمی‌کشیم).
   */
  async getPublicList(dto: GetCatalogListDto, viewerId?: string) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(48, Math.max(1, dto.perPage ?? 24));

    // کلید v2 معتبر یا هیچ — «unmapped» ادمینی اینجا معنا ندارد
    const nodeKey =
      dto.nodeKey && dto.nodeKey !== 'all' && findTaxonomyNode(dto.nodeKey)
        ? dto.nodeKey
        : null;

    const sortKey = dto.sort ?? 'related';
    const priceSort = sortKey === 'price-asc' || sortKey === 'price-desc';
    const moqSort = sortKey === 'moq-asc';

    /** مکان بینندهٔ واردشده — فقط برای امتیاز تطابق «مرتبط‌ترین» (۳۰ث کش) */
    const viewerLoc =
      sortKey === 'related' && viewerId
        ? await this.viewerLocation(viewerId)
        : null;

    // بازه‌ها — منفی/صفر = نامعتبر
    const priceMin = dto.priceMin && dto.priceMin > 0 ? dto.priceMin : undefined;
    const priceMax = dto.priceMax && dto.priceMax > 0 ? dto.priceMax : undefined;
    const moqMin = dto.moqMin && dto.moqMin > 0 ? dto.moqMin : undefined;
    const moqMax = dto.moqMax && dto.moqMax > 0 ? dto.moqMax : undefined;
    const rangeConds: Prisma.ProductWhereInput[] = [
      ...(priceMin != null ? [{ minSalePrice: { gte: priceMin } }] : []),
      ...(priceMax != null ? [{ minSalePrice: { lte: priceMax } }] : []),
      ...(moqMin != null ? [{ minSaleAmount: { gte: moqMin } }] : []),
      ...(moqMax != null ? [{ minSaleAmount: { lte: moqMax } }] : []),
    ];

    // «base» عمداً فاقد بازه‌ها و گاردهای سورت است: بازه‌ها در مسیر SQL به
    // whereٔ لیست می‌روند و در مسیر اتریبیوتی در حافظه اعمال می‌شوند؛ گاردهای
    // «قیمت/حجم تعیین‌نشده» فقط ترتیبِ لیست را صاف می‌کنند و نباید شمارش فاست را خراب کنند
    const base: Prisma.ProductWhereInput[] = [
      { status: 'confirmed' },
      ...(dto.provinceId ? [{ provinceId: dto.provinceId }] : []),
      ...(dto.cityId ? [{ cityId: dto.cityId }] : []),
    ];
    const s = (dto.search ?? '').trim();
    if (s) base.push({ productName: { contains: s } });

    let nodeIds: number[] = [];
    if (nodeKey) {
      nodeIds = this.keyToBuskolIds.get(nodeKey) ?? [];
      if (nodeIds.length === 0) return this.emptyPublicList(page, perPage, nodeKey);
      base.push({ OR: [{ subCategoryId: { in: nodeIds } }, { categoryId: { in: nodeIds } }] });
    }

    const attrs = nodeKey ? effectiveAttrs(nodeKey) : [];
    const attrSelection = this.sanitizeAttrSelection(attrs, dto.attrs);

    /** (۲۸-۱۱ دور ۵) شرایط معامله — پاک‌سازی‌شده روی مقادیر مجاز */
    const trade = sanitizeTrade(dto);

    /** شرط بدون مکان — پایهٔ فاست استان/شهر (شمارش بدون فیلتر مکان) */
    const noLocation = base.filter((w) => !('provinceId' in w) && !('cityId' in w));

    let total: number;
    let rows: Awaited<ReturnType<PrismaService['product']['findMany']>>;
    let facets: PublicCatalogFacets;

    if (attrs.length > 0) {
      // ── مسیر اتریبیوت‌محور — گرهٔ دارای اتریبیوت (اندازهٔ محدود به زیردرخت) ──
      // نامزدها بدون مکان/بازه خوانده می‌شوند تا فاست‌ها «به‌جز همین فیلتر» بتوانند؛
      // features (ویژگی‌های دستی فرم پنل — دور ۴) هم می‌آیند: اتریبیوت واقعی
      // هر آگهی = نام + دستی، دستی مقدم
      const candidates = await this.prisma.product.findMany({
        where: { AND: noLocation },
        select: {
          id: true, productName: true, features: true, provinceId: true, cityId: true, unit: true,
          minSalePrice: true, minSaleAmount: true, stock: true, isLadder: true, updatedAt: true,
          // (دور ۵) شرایط معامله — فیلتر/فاست در حافظه مثل بقیه
          sellerType: true, paymentTypes: true, hasAnalysis: true, shipping: true,
        },
      });

      // اتریبیوت‌های واقعی یک‌بار به‌ازای هر نامزده محاسبه می‌شوند (نام + دستی)؛
      // attrHits = کامل بودن ویژگی‌ها (چند ویژگی از گره پُر شده) — بخشی از امتیاز
      // «مرتبط‌ترین»
      const resolvedMap = new Map<number, Record<string, string>>();
      const enriched = candidates.map((c) => {
        const resolved = resolveProductAttrs(c.productName, c.features, attrs);
        resolvedMap.set(c.id, resolved);
        return {
          ...c,
          attrHits: attrs.reduce((n, attr) => n + (resolved[attr.key] ? 1 : 0), 0),
        };
      });

      /** آیا آگهی، گزینهٔ خواسته‌شدهٔ یک اتریبیوت را دارد؟ (wanted خالی = بی‌فیلتر) */
      const hitsWanted = (
        c: (typeof enriched)[number],
        attr: TaxonomyAttr,
        wanted?: Set<string>,
      ): boolean => {
        if (!wanted || wanted.size === 0) return true;
        return wanted.has(resolvedMap.get(c.id)?.[attr.key] ?? '');
      };

      /** تطبیق کامل یک نامزده — با پرش اختیاری یک گروه فیلتر (فاست/بازه/شرایط معامله) */
      const rangeFilters = { priceMin, priceMax, moqMin, moqMax };
      const matchC = (
        c: (typeof enriched)[number],
        skip: {
          loc?: boolean;
          price?: boolean;
          moq?: boolean;
          attr?: string;
          sellerType?: boolean;
          payment?: boolean;
          analysis?: boolean;
          shipping?: boolean;
        } = {},
      ): boolean => {
        if (!skip.loc) {
          if (dto.provinceId && c.provinceId !== dto.provinceId) return false;
          if (dto.cityId && c.cityId !== dto.cityId) return false;
        }
        if (!skip.price && (rangeFilters.priceMin != null || rangeFilters.priceMax != null)) {
          if (c.minSalePrice <= 0) return false;
          if (rangeFilters.priceMin != null && c.minSalePrice < rangeFilters.priceMin) return false;
          if (rangeFilters.priceMax != null && c.minSalePrice > rangeFilters.priceMax) return false;
        }
        if (!skip.moq) {
          if (rangeFilters.moqMin != null && c.minSaleAmount < rangeFilters.moqMin) return false;
          if (rangeFilters.moqMax != null && c.minSaleAmount > rangeFilters.moqMax) return false;
        }
        for (const attr of attrs) {
          if (attr.key === skip.attr) continue;
          if (!hitsWanted(c, attr, attrSelection[attr.key])) return false;
        }
        // (۲۸-۱۱ دور ۵) شرایط معامله — با پرش اختیاری خودشان (فاست)
        if (
          !skip.sellerType &&
          trade.sellerTypes.length &&
          !trade.sellerTypes.includes(c.sellerType ?? '')
        ) {
          return false;
        }
        if (
          !skip.payment &&
          trade.payments.length &&
          !trade.payments.some((p) => (c.paymentTypes ?? []).includes(p))
        ) {
          return false;
        }
        if (!skip.analysis && trade.analysisOnly && !c.hasAnalysis) return false;
        if (!skip.shipping && trade.shippingOnly && !c.shipping) return false;
        return true;
      };

      const list = enriched.filter((c) => matchC(c));
      total = list.length;
      list.sort(this.inMemorySorter(sortKey, viewerLoc));
      const pageIds = list.slice((page - 1) * perPage, page * perPage).map((c) => c.id);
      rows = pageIds.length
        ? await this.prisma.product.findMany({ where: { id: { in: pageIds } } })
        : [];
      const order = new Map(pageIds.map((id, i) => [id, i]));
      rows = rows
        .slice()
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

      // ── فاست‌ها (به‌جز همین فیلتر) — الگوی شمارش زندهٔ دیوار/تامینان ──
      const noLoc = enriched.filter((c) => matchC(c, { loc: true }));
      const provinceCount = new Map<number, number>();
      const cityCount = new Map<number, number>();
      for (const c of noLoc) {
        provinceCount.set(c.provinceId, (provinceCount.get(c.provinceId) ?? 0) + 1);
        cityCount.set(c.cityId, (cityCount.get(c.cityId) ?? 0) + 1);
      }

      // شمارش هر اتریبیوت با بقیهٔ فیلترها (به‌جز خودش)
      const attrCounts: Record<string, Record<string, number>> = {};
      for (const attr of attrs) {
        const subset = enriched.filter((c) => matchC(c, { attr: attr.key }));
        const counts: Record<string, number> = {};
        for (const opt of attr.options) {
          counts[opt.label] = subset.filter(
            (c) => resolvedMap.get(c.id)?.[attr.key] === opt.label,
          ).length;
        }
        attrCounts[attr.key] = counts;
      }

      // (۲۸-۱۱ دور ۵) فاست شرایط معامله — بقیهٔ فیلترها به‌جز خودِ هر گزینه؛
      // «نامشخص» (null/خالی) شمرده نمی‌شود — فیلترها فقط روی مقدار‌دارها کار می‌کنند
      const sellerTypeCounts: Record<string, number> = {};
      for (const label of SELLER_TYPE_OPTIONS) {
        const subset = enriched.filter((c) => matchC(c, { sellerType: true }));
        sellerTypeCounts[label] = subset.filter((c) => c.sellerType === label).length;
      }
      const paymentCounts: Record<string, number> = {};
      for (const label of PAYMENT_OPTIONS) {
        const subset = enriched.filter((c) => matchC(c, { payment: true }));
        paymentCounts[label] = subset.filter((c) => (c.paymentTypes ?? []).includes(label)).length;
      }
      const analysisCount = enriched
        .filter((c) => matchC(c, { analysis: true }))
        .filter((c) => c.hasAnalysis).length;
      const shippingCount = enriched
        .filter((c) => matchC(c, { shipping: true }))
        .filter((c) => c.shipping).length;

      // بازهٔ واقعی قیمت/حجم در همین گره — پلیس‌هولدر فرم بازه در فرانت
      const boundsSet = enriched.filter((c) => matchC(c, { price: true, moq: true }));
      const priced = boundsSet.filter((c) => c.minSalePrice > 0).map((c) => c.minSalePrice);
      const moqs = boundsSet.filter((c) => c.minSaleAmount > 0).map((c) => c.minSaleAmount);

      facets = {
        ...(await this.locRows(provinceCount, cityCount)),
        attrs: attrCounts,
        trade: {
          sellerTypes: sellerTypeCounts,
          payments: paymentCounts,
          analysis: analysisCount,
          shipping: shippingCount,
        },
        price: {
          min: priced.length ? Math.min(...priced) : null,
          max: priced.length ? Math.max(...priced) : null,
        },
        moq: {
          min: moqs.length ? Math.min(...moqs) : null,
          max: moqs.length ? Math.max(...moqs) : null,
        },
      };
    } else {
      // ── مسیر SQL خالص — گره بدون اتریبیوت یا «همهٔ دسته‌ها» ──
      // بازه‌ها + گاردهای سورت + شرایط معامله (دور ۵) فقط به whereٔ لیست می‌روند
      const tConds = tradeConds(trade);
      const where: Prisma.ProductWhereInput = {
        AND: [
          ...base,
          ...rangeConds,
          ...tConds,
          ...(priceSort ? [{ minSalePrice: { gt: 0 } }] : []),
          ...(moqSort ? [{ minSaleAmount: { gt: 0 } }] : []),
        ],
      };

      if (sortKey === 'related' && viewerLoc?.cityId) {
        // ── «مرتبط‌ترین» با بینندهٔ واردشده — دو پارهٔ SQL: آگهی‌های شهر خودِ
        //    کاربر اول، بعد بقیه؛ در هر پاره: نردبان بعد تازگی. ۶۲هزار آگهی به
        //    حافظه کشیده نمی‌شود — صفحۀ خواسته‌شده از روی مرز دو پاره برش می‌خورد.
        const cityOf = viewerLoc.cityId;
        const whereA: Prisma.ProductWhereInput = { AND: [...base, ...rangeConds, ...tConds, { cityId: cityOf }] };
        const whereB: Prisma.ProductWhereInput = {
          AND: [...base, ...rangeConds, ...tConds, { cityId: { not: cityOf } }],
        };
        const orderBy: Prisma.ProductOrderByWithRelationInput[] = [
          { isLadder: 'desc' },
          { updatedAt: 'desc' },
        ];
        const [countA, countB] = await Promise.all([
          this.prisma.product.count({ where: whereA }),
          this.prisma.product.count({ where: whereB }),
        ]);
        total = countA + countB;
        const skip = (page - 1) * perPage;
        const takeA = Math.max(0, Math.min(perPage, countA - skip));
        const skipB = Math.max(0, skip - countA);
        const takeB = Math.max(0, Math.min(perPage - takeA, countB - skipB));
        const [rowsA, rowsB] = await Promise.all([
          takeA > 0
            ? this.prisma.product.findMany({ where: whereA, orderBy, skip, take: takeA })
            : Promise.resolve([]),
          takeB > 0
            ? this.prisma.product.findMany({ where: whereB, orderBy, skip: skipB, take: takeB })
            : Promise.resolve([]),
        ]);
        rows = [...rowsA, ...rowsB];
      } else {
        const orderBy: Prisma.ProductOrderByWithRelationInput[] =
          sortKey === 'price-asc'
            ? [{ minSalePrice: 'asc' }, { updatedAt: 'desc' }]
            : sortKey === 'price-desc'
              ? [{ minSalePrice: 'desc' }, { updatedAt: 'desc' }]
              : sortKey === 'moq-asc'
                ? [{ minSaleAmount: 'asc' }, { updatedAt: 'desc' }]
                : sortKey === 'stock-desc'
                  ? [{ stock: 'desc' }, { updatedAt: 'desc' }]
                  // related بدون بیننده (مهمان) = همان جدیدترین (نردبان + تازگی)
                  : [{ isLadder: 'desc' }, { updatedAt: 'desc' }];
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

      // فاست‌های SQL — groupBy ارزان روی ستون‌های فهرست‌شده
      // مکان از شرط فاست حذف می‌شود تا همهٔ استان‌ها شمرده شوند؛ بازه‌ها +
      // شرایط معامله می‌مانند (فاست استان/شهر همهٔ فیلترهای غیرمکان را می‌بیند)
      const facetWhere: Prisma.ProductWhereInput = { AND: [...noLocation, ...rangeConds, ...tConds] };
      // بازهٔ واقعی — شرط با مکان و بدون بازه‌ها
      const boundsWhere: Prisma.ProductWhereInput = { AND: base };
      const [byProvince, byCity, priceAgg, moqAgg, bySellerType, payCount, payCheque, payCredit, analysisN, shippingN] =
        await Promise.all([
          this.prisma.product.groupBy({ by: ['provinceId'], _count: { _all: true }, where: facetWhere }),
          this.prisma.product.groupBy({ by: ['cityId'], _count: { _all: true }, where: facetWhere }),
          this.prisma.product.aggregate({
            where: { ...boundsWhere, minSalePrice: { gt: 0 } },
            _min: { minSalePrice: true },
            _max: { minSalePrice: true },
          }),
          this.prisma.product.aggregate({
            where: { ...boundsWhere, minSaleAmount: { gt: 0 } },
            _min: { minSaleAmount: true },
            _max: { minSaleAmount: true },
          }),
          // ── (دور ۵) فاست شرایط معامله — هر گروه با «بقیهٔ فیلترها به‌جز خودش» ──
          // نوع فروشنده: همهٔ شرط‌ها جز sellerType (null = نامشخص، شمرده نمی‌شود)
          this.prisma.product.groupBy({
            by: ['sellerType'],
            _count: { _all: true },
            where: {
              AND: [
                ...noLocation,
                ...rangeConds,
                ...tradeConds({ ...trade, sellerTypes: [] }),
              ],
            },
          }),
          // پرداخت: سه شمارش جدا (hasSome = «یکی از» OR است؛ هر گزینه باید خودش
          // با بقیهٔ شرط‌ها جز پرداخت شمرده شود)
          this.prisma.product.count({
            where: {
              AND: [
                ...noLocation,
                ...rangeConds,
                ...tradeConds({ ...trade, payments: [] }),
                { paymentTypes: { has: 'نقد' } },
              ],
            },
          }),
          this.prisma.product.count({
            where: {
              AND: [
                ...noLocation,
                ...rangeConds,
                ...tradeConds({ ...trade, payments: [] }),
                { paymentTypes: { has: 'چک سررسید' } },
              ],
            },
          }),
          this.prisma.product.count({
            where: {
              AND: [
                ...noLocation,
                ...rangeConds,
                ...tradeConds({ ...trade, payments: [] }),
                { paymentTypes: { has: 'اعتباری' } },
              ],
            },
          }),
          this.prisma.product.count({
            where: {
              AND: [...noLocation, ...rangeConds, ...tradeConds({ ...trade, analysisOnly: false }), { hasAnalysis: true }],
            },
          }),
          this.prisma.product.count({
            where: {
              AND: [...noLocation, ...rangeConds, ...tradeConds({ ...trade, shippingOnly: false }), { shipping: true }],
            },
          }),
        ]);
      const provinceCount = new Map<number, number>();
      for (const g of byProvince) provinceCount.set(g.provinceId, g._count._all);
      const cityCount = new Map<number, number>();
      for (const g of byCity) cityCount.set(g.cityId, g._count._all);
      const sellerTypeCounts: Record<string, number> = {};
      for (const g of bySellerType) {
        if (g.sellerType) sellerTypeCounts[g.sellerType] = g._count._all;
      }
      facets = {
        ...(await this.locRows(provinceCount, cityCount)),
        attrs: {},
        trade: {
          sellerTypes: sellerTypeCounts,
          payments: { 'نقد': payCount, 'چک سررسید': payCheque, 'اعتباری': payCredit },
          analysis: analysisN,
          shipping: shippingN,
        },
        price: {
          min: priceAgg._min.minSalePrice ?? null,
          max: priceAgg._max.minSalePrice ?? null,
        },
        moq: {
          min: moqAgg._min.minSaleAmount ?? null,
          max: moqAgg._max.minSaleAmount ?? null,
        },
      };
    }

    // واحد پرتکرار گره — همیشه از خود زیردرخت (بدون جستجو/فیلتر) تا برچسب پایدار بماند
    const unitStats = nodeKey
      ? await this.prisma.product.groupBy({
          by: ['unit'],
          _count: { _all: true },
          where: {
            status: 'confirmed',
            OR: [{ subCategoryId: { in: nodeIds } }, { categoryId: { in: nodeIds } }],
          },
          orderBy: { _count: { unit: 'desc' } },
          take: 6,
        })
      : [];

    return {
      total,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      node: nodeKey ? this.nodeInfo(nodeKey) : null,
      attrs,
      unit: unitStats.length
        ? { top: unitStats[0].unit, list: unitStats.map((u) => ({ unit: u.unit, count: u._count._all })) }
        : null,
      facets,
      items: await this.toPublicRows(rows, attrs.length > 0),
    };
  }

  /** سورت درون‌حافظه‌ای مسیر اتریبیوتی — آگهی‌های «تماس بگیرید» (۰) انتهای سورت قیمت؛
   *  related = امتیاز تطابق: شهر بیننده ۱۰۰ / هم‌استان ۴۰ / هر ویژگیِ برخوردهٔ نام ۱؛
   *  تای‌بریک: نردبان بعد تازگی (خواستهٔ مالک ۲۸-۱۱ دور ۳) */
  private inMemorySorter(
    sortKey: string,
    viewerLoc?: { provinceId?: number; cityId?: number } | null,
  ) {
    if (sortKey === 'related') {
      const v = viewerLoc ?? null;
      const score = (c: { provinceId: number; cityId: number; attrHits: number }) =>
        (v?.cityId != null && c.cityId === v.cityId ? 100 : 0) +
        (v?.provinceId != null && c.provinceId === v.provinceId ? 40 : 0) +
        c.attrHits;
      return (
        a: { provinceId: number; cityId: number; attrHits: number; isLadder: boolean; updatedAt: Date },
        b: { provinceId: number; cityId: number; attrHits: number; isLadder: boolean; updatedAt: Date },
      ) =>
        score(b) - score(a) ||
        Number(b.isLadder) - Number(a.isLadder) ||
        b.updatedAt.getTime() - a.updatedAt.getTime();
    }
    switch (sortKey) {
      case 'price-asc':
        return (a: { minSalePrice: number; updatedAt: Date }, b: { minSalePrice: number; updatedAt: Date }) =>
          (a.minSalePrice || Infinity) - (b.minSalePrice || Infinity) ||
          b.updatedAt.getTime() - a.updatedAt.getTime();
      case 'price-desc':
        return (a: { minSalePrice: number; updatedAt: Date }, b: { minSalePrice: number; updatedAt: Date }) =>
          b.minSalePrice - a.minSalePrice ||
          b.updatedAt.getTime() - a.updatedAt.getTime();
      case 'moq-asc':
        return (a: { minSaleAmount: number }, b: { minSaleAmount: number }) =>
          (a.minSaleAmount || Infinity) - (b.minSaleAmount || Infinity);
      case 'stock-desc':
        return (a: { stock: number }, b: { stock: number }) => b.stock - a.stock;
      default:
        return (a: { isLadder: boolean; updatedAt: Date }, b: { isLadder: boolean; updatedAt: Date }) =>
          Number(b.isLadder) - Number(a.isLadder) || b.updatedAt.getTime() - a.updatedAt.getTime();
    }
  }

  /** نام و مسیر گره برای پاسخ — breadcrumb فرانت بدون درخت کامل */
  private nodeInfo(key: string) {
    return { key, name: findTaxonomyNode(key)?.name ?? key, path: taxonomyPath(key) };
  }

  /** مکان بینندهٔ واردشده (city/province) — فقط برای امتیاز «مرتبط‌ترین»؛
   *  ۳۰ث کش (همان TTL SHORT) تا هر اسکرول بی‌دیه DB نزند */
  private async viewerLocation(viewerId: string): Promise<{ provinceId?: number; cityId?: number } | null> {
    return this.cache.wrap(
      `catalog:v2:viewer:${viewerId}`,
      { ttlMs: TTL.SHORT },
      () =>
        this.prisma.user
          .findUnique({
            where: { id: viewerId },
            select: { isActive: true, provinceId: true, cityId: true },
          })
          .then((u) =>
            u && u.isActive && u.cityId != null
              ? { provinceId: u.provinceId ?? undefined, cityId: u.cityId }
              : null,
          ),
    );
  }

  /** تبدیل شمارش خام استان/شهر به ردیف‌های نام‌دار فاست */
  private async locRows(
    provinceCount: Map<number, number>,
    cityCount: Map<number, number>,
  ): Promise<{ provinces: { id: number; name: string; count: number }[]; cities: { id: number; name: string; count: number }[] }> {
    const provinceIds = [...provinceCount.keys()];
    const cityIds = [...cityCount.keys()];
    if (!provinceIds.length && !cityIds.length) return { provinces: [], cities: [] };
    const names = await this.locations.getNames(provinceIds, cityIds);
    const UNKNOWN = '—';
    return {
      provinces: provinceIds
        .map((id) => ({ id, name: names.provinces.get(id) ?? UNKNOWN, count: provinceCount.get(id) ?? 0 }))
        .sort((a, b) => b.count - a.count),
      cities: cityIds
        .map((id) => ({ id, name: names.cities.get(id) ?? UNKNOWN, count: cityCount.get(id) ?? 0 }))
        .sort((a, b) => b.count - a.count),
    };
  }

  // ─── داخلی ─────────────────────────────────────────────────────────────────

  /** resolve یک دستهٔ پاسکال → کلید v2 (id، بعد نام — مقاوم در برابر ایمپورت‌های تازه) */
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

  private emptyPublicList(page: number, perPage: number, nodeKey: string) {
    return {
      total: 0,
      page,
      perPage,
      pageCount: 1,
      node: nodeKey ? this.nodeInfo(nodeKey) : null,
      attrs: [] as TaxonomyAttr[],
      unit: null,
      facets: {
        provinces: [],
        cities: [],
        attrs: {},
        price: { min: null, max: null },
        moq: { min: null, max: null },
        trade: { sellerTypes: {}, payments: {}, analysis: 0, shipping: 0 },
      } satisfies PublicCatalogFacets,
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
      sellerType?: string | null; paymentTypes?: string[]; hasAnalysis?: boolean; shipping?: boolean;
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
      // (۲۸-۱۱ دور ۵) شرایط معامله — بج کارت
      ...(r.seller_type != null ? { seller_type: r.seller_type } : {}),
      ...(r.payment_types?.length ? { payment_types: r.payment_types } : {}),
      ...(r.has_analysis ? { has_analysis: true } : {}),
      ...(r.shipping ? { shipping: true } : {}),
    }));
  }

  /** join نام‌ها + گالری + مسیر v2 — گروهی، نه به‌ازای هر ردیف */
  private async toRows(
    rows: Array<{
      id: number; productName: string; status: string; categoryId: number; subCategoryId: number;
      provinceId: number; cityId: number; userId: string; stock: number; minSaleAmount: number;
      minSalePrice: number; unit: string; isLadder: boolean; viewCount: number;
      createdAt: Date; updatedAt: Date; features?: unknown;
      sellerType?: string | null; paymentTypes?: string[]; hasAnalysis?: boolean; shipping?: boolean;
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
          ? { resolved_attrs: resolveProductAttrs(p.productName, p.features, effectiveAttrs(v2Key)) }
          : {}),
        // (۲۸-۱۱ دور ۵) شرایط معامله — عبور مستقیم برای بج کارت
        ...(p.sellerType != null ? { seller_type: p.sellerType } : {}),
        ...(p.paymentTypes?.length ? { payment_types: p.paymentTypes } : {}),
        ...(p.hasAnalysis ? { has_analysis: true } : {}),
        ...(p.shipping ? { shipping: true } : {}),
      };
    });
  }
}
