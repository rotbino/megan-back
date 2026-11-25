import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService, TTL } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';
import { CategoriesService, type CategoryNode } from '../categories/categories.service';
import { effectivePakageType } from '../packages/packages.service';
import type { AuthUser } from '../common/guards';
import type { GetMarketReportDto } from './dto';

// ─── گزارش بازار — v1 (۲۵-۱۱) ───────────────────────────────────────────────
//
// «ردیاب بازار» صنفِ فروشنده: میانگین‌گیری صادق روی آگهی‌های واقعی همان صنف.
//
// اصول قرارداد مالک (گفتگوی ۲۴/۲۵-۱۱):
//  ۱. حجم: به‌جای ستون‌های تیرِ حجمی، «میانه + بازه» — کف بازه همان خرید
//     حجمی و سقف همان خرید کوچک است؛ تیر صریح فقط از متن آگهی‌ها اگر باشد
//     (v1 از دیتای ساختاریفته صرف‌نظر؛ دیتای سه‌تیره با claim فروشنده‌ها
//     می‌آید).
//  ۲. داده کافی: هر قلم حداقل ۳ فروشندهٔ متمایز با قیمت معتبر — وگرنه
//     «داده کافی نیست»؛ صداقت دربارهٔ جای خالی خودش محصول است.
//  ۳. حریم قیمتی فروشنده‌ها: خروجی فقط تجمیعی است (میانه/بازه/شمار)؛
//     قیمت هیچ فروشنده‌ای با نامش به کسی نشان داده نمی‌شود.
//  ۴. واحد: قلم مخلوط از واحدهای مختلف → پرچم mixedUnit (نمایش عادلانه
//     نمی‌شود).
//  ۵. پارازیت: قیمت‌های پریشان (کمتر از ⅓ یا بیشتر از ۳ برابر میانه)
//     کنار گذاشته می‌شوند و آمار روی باقیٔ سالم دوباره ساخته می‌شود —
//     پروبِ زنده نشان داد بازه‌های ۱۰۰× واقعی در داده هست (کود اوره:
//     ۱٬۵۰۰ تا ۳٬۳۰۰٬۰۰۰).
//  ۶. تغییر هفتگی: از تاریخچهٔ price-sync (ProductEditHistory) فقط جایی
//     که ≥۳ تغییر واقعی در ۱۴ روز ثبت شده باشد؛ نبود → «—» (داده تازه
//     نیست). با تکرار هفتگی price-sync این ستون خودش پُر می‌شود.
//  ۷. رایگان: ۳ قلم شخصی (قلم‌هایی که خود فروشنده آگهی دارد) + شاخص صنف
//     + تلنگر «چند قلم دیگر تغییر کردند»؛ بستهٔ فعال = جدول کامل ۳۰ قلم.
//  ۸. کش: بخش تجمیعی (مستقل از کاربر) ۵ دقیقه روی هر صنف کش می‌شود —
//     فروشندگان یک صنف همه همان محاسبه را می‌بینند.

const MIN_SELLERS = 3;
const TOP_ITEMS = 30;
const FREE_PERSONAL_ITEMS = 3;
const CHANGE_WINDOW_DAYS = 14;
const SPARK_WINDOW_DAYS = 56; // پنجرهٔ روند اسپارک/نمودار: ۸ هفتهٔ غلتان (قیمت امروز نقطهٔ آخر)
const OUTLIER_LO = 1 / 3;
const OUTLIER_HI = 3;
const DAY_MS = 86_400_000;
const CACHE_TTL_MS = TTL.FIVE_MIN;

/** پلهٔ حجمی قلم — «خرده/میانه/عمده» از پراکندگی حداقل‌سفارشِ فروشنده‌ها */
export interface ReportTier {
  label: 'خرده' | 'میانه' | 'عمده';
  /** کوچک‌ترین حداقل‌سفارشِ این پله (به واحد دسته) */
  from: number;
  sellers: number;
  /** میانهٔ قیمت پله */
  median: number;
}

/** برش شهری قلم — فقط شهرهای ≥۳ فروشندهٔ متمایز */
export interface ReportCity {
  cityId: number;
  cityName: string;
  sellers: number;
  median: number;
  min: number;
  max: number;
}

/** سطر خام یک آگهی برای محاسبهٔ پله/شهر — فقط فیلد سبک */
export interface ReportRow {
  price: number;
  userId: string;
  minSaleAmount: number;
  cityId: number;
}

/** نرمال‌سازی نام قلم — «سیب قرمز و زرد» ≡ «سیب زرد و قرمز»
 *  (مجموعهٔ واژه‌های مرتب‌شده بدون «و»)؛ رقم‌ها می‌مانند (کالیبر ۲۰/۲۲
 *  قلم متفاوت است). عربی→فارسی (ي/ك)، جداکننده‌ها → فاصله. */
export function normalizeItemName(name: string): string {
  const cleaned = (name ?? '')
    .replace(/\u064A/g, '\u06CC') // ي → ی
    .replace(/\u0643/g, '\u06A9') // ك → ک
    .replace(/[_\-\/\\.,،؛:!|+()[\]{}"'«»؟?*%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const words = cleaned.split(' ').filter((w) => w && w !== 'و');
  if (!words.length) return '';
  return [...new Set(words)].sort().join(' ');
}

/** میانهٔ — هم‌قرارداد v1؛ عمومی برای بقیهٔ گزارشات */
export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** نام شهرها به‌شناسهٔ عددی — یک کوئری برای همهٔ شهرهای موجود */
export async function cityNamesFor(
  prisma: Pick<PrismaService, 'location'>,
  cityIds: number[],
): Promise<Map<number, string>> {
  const ids = [...new Set(cityIds)].filter((id) => id != null && id > 0);
  if (!ids.length) return new Map();
  const rows = await prisma.location.findMany({
    where: { type: 'city', buskolId: { in: ids } },
    select: { buskolId: true, name: true },
  });
  return new Map(rows.map((r) => [r.buskolId, r.name]));
}

/** پله‌های حجمی (خرده/میانه/عمده) — ترسوم حداقل‌سفارش‌ها؛ هر پله ≥۲ فروشندهٔ
 *  متمایز وگرنه حذف؛ کمتر از ۲ پله → اصلاً تیر نیست (null). */
export function computeTiers(rows: ReportRow[]): ReportTier[] | null {
  if (rows.length < 6) return null;
  const amounts = rows.map((r) => r.minSaleAmount).sort((a, b) => a - b);
  const p33 = amounts[Math.floor(rows.length / 3)];
  const p66 = amounts[Math.floor((rows.length * 2) / 3)];
  if (p33 == null || p66 == null || p33 === p66) return null; // همه یک حداقل‌سفارش‌اند — پله معنا ندارد
  const defs: Array<{ label: ReportTier['label']; lo: number; hi: number }> = [
    { label: 'خرده', lo: -1, hi: p33 },
    { label: 'میانه', lo: p33, hi: p66 },
    { label: 'عمده', lo: p66, hi: Number.MAX_SAFE_INTEGER },
  ];
  const tiers: ReportTier[] = [];
  for (const d of defs) {
    const bucket = rows.filter((r) => r.minSaleAmount >= d.lo && r.minSaleAmount < d.hi);
    const sellers = new Set(bucket.map((r) => r.userId)).size;
    if (sellers < 2) continue;
    const med = median(bucket.map((r) => r.price));
    if (med == null) continue;
    tiers.push({
      label: d.label,
      from: Math.min(...bucket.map((r) => r.minSaleAmount)),
      sellers,
      median: Math.round(med),
    });
  }
  return tiers.length >= 2 ? tiers : null;
}

/** برش شهری — گروه‌بندی سطرها بر شهر؛ فقط شهرهای ≥minSellers فروشندهٔ متمایز */
export function computeCities(
  rows: ReportRow[],
  cityNames: Map<number, string>,
  minSellers: number,
  top: number,
): ReportCity[] | null {
  const byCity = new Map<number, { prices: number[]; users: Set<string> }>();
  for (const r of rows) {
    if (!r.cityId) continue;
    let c = byCity.get(r.cityId);
    if (!c) byCity.set(r.cityId, (c = { prices: [], users: new Set() }));
    c.prices.push(r.price);
    c.users.add(r.userId);
  }
  const cities: ReportCity[] = [];
  for (const [cityId, c] of byCity) {
    const name = cityNames.get(cityId);
    if (!name || c.users.size < minSellers) continue;
    const med = median(c.prices);
    if (med == null) continue;
    cities.push({
      cityId,
      cityName: name,
      sellers: c.users.size,
      median: Math.round(med),
      min: Math.round(Math.min(...c.prices)),
      max: Math.round(Math.max(...c.prices)),
    });
  }
  cities.sort((a, b) => b.sellers - a.sellers);
  const res = cities.slice(0, top);
  return res.length ? res : null;
}

/** تغییر هفتگی + اسپارک هفتگی از تاریخچهٔ price-sync — هم‌قرارداد v1 */
export function changeAndSpark(
  productIds: number[],
  historyByProduct: Map<number, Array<{ before: number; after: number; at: Date }>>,
  pidToUser: Map<number, string>,
  med: number,
): { changePct: number | null; spark: Array<{ weekStart: string; value: number }> | null } {
  const listingChanges: number[] = [];
  const changedSellers = new Set<string>();
  // «تغییر هفته» فقط تغییر‌های اخیر (۱۴ روز) — معنای هفته‌ای دقیق بماند
  const changeSince = Date.now() - CHANGE_WINDOW_DAYS * DAY_MS;
  for (const pid of productIds) {
    const hs = historyByProduct.get(pid);
    if (!hs?.length) continue;
    const recent = hs.filter((h) => h.at.getTime() >= changeSince);
    if (!recent.length) continue;
    changedSellers.add(pidToUser.get(pid) ?? String(pid));
    for (const h of recent) listingChanges.push((h.after - h.before) / h.before);
  }
  const changePct =
    listingChanges.length >= MIN_SELLERS && changedSellers.size >= MIN_SELLERS
      ? Math.round((median(listingChanges) ?? 0) * 1000) / 10
      : null;
  // اسپارک هفتگی از کل پنجرهٔ ۸ هفته‌ای (هر هفته میانهٔ قیمت‌های همان هفته)
  const weekBuckets = new Map<number, number[]>();
  const nowWeek = Math.floor(Date.now() / (7 * DAY_MS));
  for (const pid of productIds) {
    for (const h of historyByProduct.get(pid) ?? []) {
      const wk = Math.floor(h.at.getTime() / (7 * DAY_MS));
      (weekBuckets.get(wk) ?? weekBuckets.set(wk, []).get(wk)!).push(h.after);
    }
  }
  (weekBuckets.get(nowWeek) ?? weekBuckets.set(nowWeek, []).get(nowWeek)!).push(med);
  const spark =
    weekBuckets.size >= 2
      ? [...weekBuckets.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([wk, ps]) => ({
            weekStart: new Date(wk * 7 * DAY_MS).toISOString(),
            value: Math.round(median(ps) ?? 0),
          }))
      : null;
  return { changePct, spark };
}

interface GroupRaw {
  /** نام نمونهٔ خوانا (طولانی‌ترین نام گروه) */
  sample: string;
  prices: number[];
  productIds: number[];
  users: Set<string>;
  units: Set<string>;
  listings: number;
  /** سطرهای خام برای پلهٔ حجمی + برش شهری */
  rows: ReportRow[];
}

export interface MarketReportItem {
  name: string;
  unit: string;
  sellers: number;
  listings: number;
  median: number | null;
  min: number | null;
  max: number | null;
  changePct: number | null;
  /** نقطه‌های هفتگی برای اسپارک‌لاین — فقط وقتی ≥۲ هفته داده باشد */
  spark: Array<{ weekStart: string; value: number }> | null;
  mixedUnit: boolean;
  /** پله‌های حجمی (خرده/میانه/عمده) — null یعنی دادهٔ پشتیبانِ پله نیست */
  tiers: ReportTier[] | null;
  /** برش شهری (تا ۳ شهر) — null یعنی هیچ شهری ≥۳ فروشنده ندارد */
  cities: ReportCity[] | null;
  /** قیمت خود فروشنده در همین قلم — فقط برای خودش (حریم: نام دیگران نه) */
  mine: { price: number; diffPct: number | null; expired: boolean } | null;
}

interface Aggregate {
  generatedAt: string;
  listingCount: number;
  sellerCount: number;
  unit: string;
  /** همهٔ گروه‌های سالم (≥۳ فروشنده) مرتب بر تعداد فروشنده */
  items: MarketReportItem[];
  /** قلم‌هایی که هنوز کمتر از ۳ فروشنده قیمت داده‌اند */
  insufficient: number;
  index: { value: number | null; basis: number };
  changedItems: number;
}

@Injectable()
export class MarketReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly categories: CategoriesService,
  ) {}

  /** POST /products/getMarketReport — گزارش بازار صنف فروشنده */
  async getMarketReport(user: AuthUser, dto: GetMarketReportDto) {
    // ── صنف: دستهٔ برگِ خودش (پرآگهی‌ترین) یا دستهٔ صریح درخواستی ──
    const leaf = await this.resolveLeafCategory(user.id, dto.subCategoryId);
    if (!leaf) {
      return {
        category: null,
        packageActive: await this.packageActive(user.id),
        generatedAt: new Date().toISOString(),
        // کاربر بدون کالا — فرانت حالت خالی «اول کالا ثبت کن» نشان می‌دهد
      };
    }

    const agg = await this.getAggregate(leaf);

    // ── لایهٔ شخصی (بیرون از کش): آگهی‌های خودِ فروشنده در همین صنف ──
    const mine = await this.prisma.product.findMany({
      where: {
        userId: user.id,
        subCategoryId: leaf.id,
        status: { in: ['confirmed', 'pending'] },
      },
      select: { productName: true, minSalePrice: true, unit: true, priceUpdatedAt: true, priceValidityDays: true },
    });
    const mineByGroup = new Map<string, { price: number; expired: boolean }[]>();
    for (const m of mine) {
      const k = normalizeItemName(m.productName);
      if (!k || !m.minSalePrice) continue;
      const expired =
        m.priceUpdatedAt != null &&
        m.priceUpdatedAt.getTime() + m.priceValidityDays * DAY_MS < Date.now();
      (mineByGroup.get(k) ?? mineByGroup.set(k, []).get(k)!).push({ price: m.minSalePrice, expired });
    }

    const attachMine = (it: MarketReportItem): MarketReportItem => {
      const rows = mineByGroup.get(normalizeItemName(it.name));
      if (!rows?.length) return { ...it, mine: null };
      // خودِ فروشنده اگر چند آگهی در همان قلم دارد → پایین‌ترین قیمتِ فعالش
      const active = rows.filter((r) => !r.expired);
      const pool = active.length ? active : rows;
      const price = Math.min(...pool.map((r) => r.price));
      const diffPct =
        it.median && it.median > 0 ? Math.round(((price - it.median) / it.median) * 1000) / 10 : null;
      return { ...it, mine: { price, diffPct, expired: !active.length } };
    };

    const packageActive = await this.packageActive(user.id);
    const category = await this.categoryInfo(leaf);
    const personal = agg.items
      .filter((it) => mineByGroup.has(normalizeItemName(it.name)))
      .map(attachMine);

    if (packageActive) {
      return {
        category,
        generatedAt: agg.generatedAt,
        packageActive: true,
        listingCount: agg.listingCount,
        sellerCount: agg.sellerCount,
        index: agg.index,
        items: agg.items.map(attachMine),
        myItemNames: personal.map((p) => p.name),
        teaser: {
          insufficient: agg.insufficient,
          changedItems: agg.changedItems,
        },
      };
    }

    // ── رایگان: ۳ قلم شخصی + شاخص + تلنگر (بقیه پشت درِ بسته) ──
    const personalTop = personal.slice(0, FREE_PERSONAL_ITEMS);
    return {
      category,
      generatedAt: agg.generatedAt,
      packageActive: false,
      listingCount: agg.listingCount,
      sellerCount: agg.sellerCount,
      index: agg.index,
      myItems: personalTop,
      personalTotal: personal.length,
      lockedItems: Math.max(0, agg.items.length - personalTop.length),
      teaser: {
        insufficient: agg.insufficient,
        changedItems: agg.changedItems,
        totalItems: agg.items.length,
      },
    };
  }

  // ─── داخلی ────────────────────────────────────────────────────────────

  /** بخش تجمیعی صنف (کش ۵ دقیقه) — هم‌فقرهٔ getMarketReport و بقیهٔ گزارشات */
  async getAggregate(leaf: CategoryNode): Promise<Aggregate> {
    return this.cache.wrap<Aggregate>(
      `market-report:cat:${leaf.id}`,
      { ttlMs: CACHE_TTL_MS },
      () => this.buildAggregate(leaf),
    );
  }

  /** بستهٔ فعال مؤثر (انقضا لحاظ‌شده) — عمومی؛ بقیهٔ گزارشات هم می‌پرسند */
  async packageActiveOf(userId: string): Promise<boolean> {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { activePakageType: true, packageExpiresAt: true },
    });
    return effectivePakageType(me?.activePakageType ?? 0, me?.packageExpiresAt) > 0;
  }

  /** بستهٔ فعال — wrapper خصوصی برای سازگاری */
  private async packageActive(userId: string): Promise<boolean> {
    return this.packageActiveOf(userId);
  }

  /** صنفِ کاربر: پرآگهی‌ترین دستهٔ برگِ confirmed او؛ یا دستهٔ صریحِ مجاز */
  private async resolveLeafCategory(userId: string, explicit?: number): Promise<CategoryNode | null> {
    if (explicit) {
      const cat = await this.categories.getCategoryById(explicit);
      if (!cat) throw AppError.badRequest('دسته انتخابی معتبر نیست.', 'BAD_CATEGORY');
      return cat;
    }
    // آگهی‌های خودِ فروشنده کم‌اند (نه ۵۰هزارتا) — شمارش در JS ساده و مطمئن
    const mine = await this.prisma.product.findMany({
      where: { userId, status: 'confirmed' },
      select: { subCategoryId: true },
    });
    const counts = new Map<number, number>();
    for (const m of mine) counts.set(m.subCategoryId, (counts.get(m.subCategoryId) ?? 0) + 1);
    let topId: number | null = null;
    let topN = 0;
    for (const [id, n] of counts) {
      if (n > topN) {
        topN = n;
        topId = id;
      }
    }
    if (topId == null) return null;
    return this.categories.getCategoryById(topId);
  }

  /** مسیر خوانا: ریشه ← میانی ← برگ (هر چه موجود) — عمومی؛ بقیهٔ گزارشات هم */
  async categoryInfo(leaf: CategoryNode) {
    const path: string[] = [leaf.category_name];
    if (leaf.parent_id != null) {
      const mid = await this.categories.getCategoryById(leaf.parent_id);
      if (mid) {
        path.unshift(mid.category_name);
        if (mid.parent_id != null) {
          const root = await this.categories.getCategoryById(mid.parent_id);
          if (root) path.unshift(root.category_name);
        }
      }
    }
    return { id: leaf.id, name: leaf.category_name, unit: leaf.unit, path: path.join(' ← ') };
  }

  /** سازندهٔ بخش تجمیعی — مستقل از کاربر (کش می‌شود) */
  private async buildAggregate(leaf: CategoryNode): Promise<Aggregate> {
    const rows = await this.prisma.product.findMany({
      where: {
        subCategoryId: leaf.id,
        status: 'confirmed',
        minSalePrice: { gt: 0 },
        ownerPaused: false,
      },
      select: {
        id: true,
        productName: true,
        minSalePrice: true,
        userId: true,
        unit: true,
        minSaleAmount: true,
        cityId: true,
      },
    });

    // نام شهرهای موجود در صنف — یک کوئری
    const cityNames = await cityNamesFor(this.prisma, rows.map((r) => r.cityId));

    // گروه‌بندی نام نرمال‌شده
    const groups = new Map<string, GroupRaw>();
    const allSellers = new Set<string>();
    for (const r of rows) {
      allSellers.add(r.userId);
      const k = normalizeItemName(r.productName);
      if (!k) continue;
      let g = groups.get(k);
      if (!g) {
        g = {
          sample: r.productName,
          prices: [],
          productIds: [],
          users: new Set(),
          units: new Set(),
          listings: 0,
          rows: [],
        };
        groups.set(k, g);
      }
      g.listings++;
      g.users.add(r.userId);
      g.prices.push(r.minSalePrice);
      g.units.add(r.unit);
      g.productIds.push(r.id);
      g.rows.push({ price: r.minSalePrice, userId: r.userId, minSaleAmount: r.minSaleAmount, cityId: r.cityId });
      // نام نمونهٔ خواناتر (بلندترین) برای نمایش
      if (r.productName.length > g.sample.length) g.sample = r.productName;
    }

    // تاریخچهٔ قیمت (price-sync) برای تغییر هفتگی + اسپارک — یک کوئری
    const pidToUser = new Map<number, string>();
    for (const r of rows) pidToUser.set(r.id, r.userId);
    const allIds = [...groups.values()].flatMap((g) => g.productIds);
    const history = allIds.length
      ? await this.prisma.productEditHistory.findMany({
          where: { productId: { in: allIds }, createdAt: { gte: new Date(Date.now() - SPARK_WINDOW_DAYS * DAY_MS) } },
          select: { productId: true, before: true, after: true, createdAt: true },
        })
      : [];
    const historyByProduct = new Map<number, Array<{ before: number; after: number; at: Date }>>();
    for (const h of history) {
      const b = (h.before as { minSalePrice?: number } | null)?.minSalePrice;
      const a = (h.after as { minSalePrice?: number } | null)?.minSalePrice;
      if (!b || !a || b <= 0 || a <= 0) continue;
      (historyByProduct.get(h.productId) ?? historyByProduct.set(h.productId, []).get(h.productId)!).push({
        before: b,
        after: a,
        at: h.createdAt,
      });
    }

    const items: MarketReportItem[] = [];
    let insufficient = 0;
    const changePcts: number[] = [];

    for (const g of groups.values()) {
      if (g.users.size < MIN_SELLERS) {
        insufficient++;
        continue;
      }

      // پارازیت‌زدایی: بازهٔ [⅓میانه، ۳×میانه] و بازسازی آمار روی سالم‌ها
      const m1 = median(g.prices)!;
      const kept = g.prices.filter((p) => p >= m1 * OUTLIER_LO && p <= m1 * OUTLIER_HI);
      const use = kept.length >= MIN_SELLERS ? kept : g.prices;
      const med = median(use)!;

      // سطرهای سالمِ همان گروه — برای پلهٔ حجمی + برش شهری
      const healthyRows = g.rows.filter((r) => r.price >= m1 * OUTLIER_LO && r.price <= m1 * OUTLIER_HI);
      const useRows = healthyRows.length >= MIN_SELLERS ? healthyRows : g.rows;

      // تغییر هفتگی + اسپارک — از تاریخچهٔ price-sync (هم‌قرارداد v1)
      const { changePct, spark } = changeAndSpark(g.productIds, historyByProduct, pidToUser, med);
      if (changePct != null) changePcts.push(changePct);

      items.push({
        name: g.sample,
        unit: g.units.size === 1 ? [...g.units][0] : leaf.unit,
        sellers: g.users.size,
        listings: g.listings,
        median: Math.round(med),
        min: Math.round(Math.min(...use)),
        max: Math.round(Math.max(...use)),
        changePct,
        spark,
        mixedUnit: g.units.size > 1,
        tiers: computeTiers(useRows),
        cities: computeCities(useRows, cityNames, MIN_SELLERS, 3),
        mine: null,
      });
    }

    items.sort((a, b) => b.sellers - a.sellers || b.listings - a.listings);
    const top = items.slice(0, TOP_ITEMS);
    const index =
      changePcts.length >= MIN_SELLERS
        ? { value: Math.round(median(changePcts)! * 10) / 10, basis: changePcts.length }
        : { value: null, basis: changePcts.length };

    return {
      generatedAt: new Date().toISOString(),
      listingCount: rows.length,
      sellerCount: allSellers.size,
      unit: leaf.unit,
      items: top,
      insufficient,
      index,
      changedItems: changePcts.length,
    };
  }
}
