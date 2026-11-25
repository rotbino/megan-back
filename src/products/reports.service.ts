import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService, TTL } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';
import { CategoriesService, type CategoryNode } from '../categories/categories.service';
import { ActiveUsersService } from '../common/active-users/active-users.module';
import type { AuthUser } from '../common/guards';
import { MarketReportService } from './market-report.service';
import {
  normalizeItemName,
  median,
  cityNamesFor,
  computeTiers,
  computeCities,
  changeAndSpark,
  type ReportTier,
  type ReportCity,
} from './market-report.service';
import type { GetItemReportDto } from './dto';

// ─── گزارشات ایمچ v1 (۲۵-۱۱ — راند دوم) ─────────────────────────────────────
//
// چهار گزارش در یک سرویس، همه روی همان موتور تجمیعی رصد صنف (کش ۵ دقیقه):
//  ۱. getItemReport — گزارش تک‌کالا: نقطهٔ تصمیم خریدار روی خود آگهی.
//     «این قیمت کجا از بازار ایستاده؟» با پلهٔ حجمی، برش شهری و جایگاه
//     قیمت در برابر سایر فروشنده‌های همان قلم (تجمیمی).
//  ۲. getBuyAdvisor — مشاور خرید دوره‌ای: سبد خرید دوره‌ای خریدار (BuyerCategory)
//     × قیمت بازار؛ سیگنال «الان بخر / صبر کن» از فاصلهٔ قیمت امروز تا
//     میانگین ۸ هفتهٔ همان قلم.
//  ۳. getOpportunityMap — نقشهٔ فرصت فروش: تقاضا (درخواست خرید ۳۰ روز + بازدید
//     آگهی‌ها) ÷ عرضه (فروشنده‌های همان صنف) — صادقانه «تقاضای ثبت‌شده»
//     نه «فروش تضمینی».
//  ۴. getPriceIndex — شاخص قیمت ایمچ: عمومی و فقط درصدی (بدون قیمت مطلق —
//     همان گِیت قیمتِ اعضا رعایت می‌شود).
//
// فریمیوم همهٔ گزارشات پولی: ۳ ردیف زندهٔ کامل + شمار قفل‌ها — کاربر از
// همان ۳ ردیف واقعی می‌فهمد گزارش چه می‌دهد؛ بقیه با بستهٔ فعال.

const DAY_MS = 86_400_000;
const MIN_SELLERS = 3;
const FREE_ROWS = 3;
const ADVISOR_ITEMS = 5;
const OPPORTUNITY_TOP = 30;
const INDEX_TOP = 12;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly categories: CategoriesService,
    private readonly marketReport: MarketReportService,
    private readonly activeUsers: ActiveUsersService,
  ) {}

  // ─── ۱. گزارش تک‌کالا ──────────────────────────────────────────────────

  /** POST /products/getItemReport — عمومیِ اعضا؛ تماماً تجمیعی */
  async getItemReport(user: AuthUser, dto: GetItemReportDto) {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, status: 'confirmed' },
      select: {
        id: true,
        productName: true,
        slug: true,
        subCategoryId: true,
        unit: true,
        cityId: true,
        minSaleAmount: true,
        minSalePrice: true,
        priceUpdatedAt: true,
        priceValidityDays: true,
      },
    });
    if (!product || !product.minSalePrice) {
      throw AppError.notFound('کالا پیدا نشد یا قیمت ثبت‌شده ندارد.');
    }
    const leaf = await this.categories.getCategoryById(product.subCategoryId);
    if (!leaf) throw AppError.notFound('دستهٔ کالا پیدا نشد.');

    const group = normalizeItemName(product.productName);
    const rows = await this.prisma.product.findMany({
      where: {
        subCategoryId: leaf.id,
        status: 'confirmed',
        minSalePrice: { gt: 0 },
        ownerPaused: false,
        ...(await this.activeUsers.activeUserWhere()),
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
    const ofGroup = rows.filter((r) => normalizeItemName(r.productName) === group);
    const sellers = new Set(ofGroup.map((r) => r.userId)).size;

    const category = await this.marketReport.categoryInfo(leaf);
    const cityNames = await cityNamesFor(this.prisma, ofGroup.map((r) => r.cityId));

    const base = {
      productId: product.id,
      product: {
        id: product.id,
        name: product.productName,
        unit: product.unit,
        minSaleAmount: product.minSaleAmount,
        price: product.minSalePrice,
        city: cityNames.get(product.cityId) ?? null,
        category,
        /** مسیر بازگشت به خود آگهی */
        href: `/product-view/${product.slug}/${category.name}/${product.id}`,
      },
      generatedAt: new Date().toISOString(),
    };

    if (sellers < MIN_SELLERS) {
      // صداقت: قلم هنوز آمار ندارد — عدد نصفه نمی‌سازیم
      return { ...base, sufficient: false, sellers };
    }

    // پارازیت‌زدایی هم‌قرارداد رصد صنف
    const prices = ofGroup.map((r) => r.minSalePrice);
    const m1 = median(prices)!;
    const kept = prices.filter((p) => p >= m1 / 3 && p <= m1 * 3);
    const use = kept.length >= MIN_SELLERS ? kept : prices;
    const med = median(use)!;
    const healthyRows = ofGroup.filter(
      (r) => r.minSalePrice >= m1 / 3 && r.minSalePrice <= m1 * 3,
    );
    const useRows = healthyRows.length >= MIN_SELLERS ? healthyRows : ofGroup;
    const reportRows = useRows.map((r) => ({
      price: r.minSalePrice,
      userId: r.userId,
      minSaleAmount: r.minSaleAmount,
      cityId: r.cityId,
    }));

    // تاریخچهٔ قیمت همان قلم — تغییر هفتگی + اسپارک
    const pidToUser = new Map<number, string>();
    for (const r of ofGroup) pidToUser.set(r.id, r.userId);
    const history = await this.prisma.productEditHistory.findMany({
      where: {
        productId: { in: ofGroup.map((r) => r.id) },
        createdAt: { gte: new Date(Date.now() - 56 * DAY_MS) }, // پنجرهٔ ۸ هفتهٔ غلتان — هم‌قاعد market-report
      },
      select: { productId: true, before: true, after: true, createdAt: true },
    });
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
    const { changePct, spark } = changeAndSpark(
      ofGroup.map((r) => r.id),
      historyByProduct,
      pidToUser,
      med,
    );

    // جایگاه قیمت این آگهی بین فروشنده‌های همان قلم (تجمیمی — بدون نام)
    const expired =
      product.priceUpdatedAt != null &&
      product.priceUpdatedAt.getTime() + product.priceValidityDays * DAY_MS < Date.now();
    const diffPct = med > 0 ? Math.round(((product.minSalePrice - med) / med) * 1000) / 10 : null;
    const cheaperThan = use.length
      ? Math.round((use.filter((p) => p < product.minSalePrice).length / use.length) * 100)
      : null;

    const units = new Set(ofGroup.map((r) => r.unit));
    return {
      ...base,
      sufficient: true,
      sellers,
      listings: ofGroup.length,
      median: Math.round(med),
      min: Math.round(Math.min(...use)),
      max: Math.round(Math.max(...use)),
      changePct,
      spark,
      mixedUnit: units.size > 1,
      tiers: computeTiers(reportRows),
      cities: computeCities(reportRows, cityNames, MIN_SELLERS, 3),
      position: { diffPct, cheaperThan, expired },
    };
  }

  // ─── ۲. مشاور خرید دوره‌ای ────────────────────────────────────────────

  /** POST /products/getBuyAdvisor — سبد خرید دوره‌ای خریدار × قیمت بازار */
  async getBuyAdvisor(user: AuthUser) {
    const mine = await this.prisma.buyerCategory.findMany({
      where: { userId: user.id, status: 'confirmed' },
      orderBy: { createdAt: 'asc' },
    });
    const pendingCount = await this.prisma.buyerCategory.count({
      where: { userId: user.id, status: 'pending' },
    });
    const packageActive = await this.marketReport.packageActiveOf(user.id);

    const rows: Array<unknown> = [];
    for (const bc of mine) {
      const leaf = await this.categories.getCategoryById(bc.categoryId);
      if (!leaf) continue;
      const agg = await this.marketReport.getAggregate(leaf);
      const category = await this.marketReport.categoryInfo(leaf);
      const items = agg.items.slice(0, ADVISOR_ITEMS).map((it) => {
        // سیگنال: قیمت امروز نسبت به میانگین ۸ هفتهٔ خود قلم
        let signal: 'buy' | 'wait' | null = null;
        let devPct: number | null = null;
        if (it.spark && it.spark.length >= 3) {
          const vals = it.spark.map((p) => p.value);
          const avg = vals.slice(0, -1).reduce((a, b) => a + b, 0) / (vals.length - 1);
          if (avg > 0) {
            devPct = Math.round(((vals[vals.length - 1] - avg) / avg) * 1000) / 10;
            if (devPct <= -5) signal = 'buy';
            else if (devPct >= 5) signal = 'wait';
          }
        }
        return {
          name: it.name,
          unit: it.unit,
          sellers: it.sellers,
          median: it.median,
          min: it.min,
          max: it.max,
          changePct: it.changePct,
          spark: packageActive ? it.spark : null,
          cities: packageActive ? (it.cities ?? null) : null,
          tiers: packageActive ? (it.tiers ?? null) : null,
          signal,
          devPct,
        };
      });
      rows.push({
        category,
        volumeMin: bc.volumeMin,
        period: bc.period,
        index: agg.index,
        items,
      });
    }

    const lockedRows = packageActive ? 0 : Math.max(0, rows.length - FREE_ROWS);
    return {
      rows: packageActive ? rows : rows.slice(0, FREE_ROWS),
      totalRows: rows.length,
      lockedRows,
      packageActive,
      pendingCount,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── ۳. نقشهٔ فرصت فروش ────────────────────────────────────────────────

  /** POST /products/getOpportunityMap — تقاضا ÷ عرضه بر دسته‌های فعال */
  async getOpportunityMap(user: AuthUser) {
    const packageActive = await this.marketReport.packageActiveOf(user.id);
    const stats = await this.categoryStats();
    const demands = await this.prisma.buyRequest.groupBy({
      by: ['categoryId'],
      where: {
        status: 'confirmed',
        createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) },
      },
      _count: { _all: true },
    });
    const demandByCat = new Map(demands.map((d) => [d.categoryId, d._count._all]));

    const candidates = [...stats.entries()]
      .map(([catId, s]) => {
        const requests = demandByCat.get(catId) ?? 0;
        // سیگنال مطلق تقاضا: درخواست‌های ۳۰ روز + بازدیدها — بدون تقسیم بر عرضه
        // (تقسیم در دادهٔ کم امروز همه را صفر می‌کرد)؛ ستون فروشنده‌ها خودش عرضه را نشان می‌دهد
        const score = Math.round((requests * 10 + s.views / 100) * 10) / 10;
        return { catId, requests, ...s, score };
      })
      .filter((c) => c.sellers >= MIN_SELLERS)
      .sort((a, b) => b.score - a.score || b.requests - a.requests)
      .slice(0, OPPORTUNITY_TOP);

    const rows = [];
    for (const c of candidates) {
      const leaf = await this.categories.getCategoryById(c.catId);
      if (!leaf) continue;
      const agg = await this.marketReport.getAggregate(leaf);
      const category = await this.marketReport.categoryInfo(leaf);
      const topItems = agg.items.slice(0, 3).map((it) => ({
        name: it.name,
        median: it.median,
        sellers: it.sellers,
      }));
      rows.push({
        category,
        requests30d: c.requests,
        sellers: c.sellers,
        listings: c.listings,
        views: c.views,
        score: Math.round(c.score * 10) / 10,
        topItems,
        index: agg.index,
      });
    }

    const lockedRows = packageActive ? 0 : Math.max(0, rows.length - FREE_ROWS);
    return {
      rows: packageActive ? rows : rows.slice(0, FREE_ROWS),
      totalRows: rows.length,
      lockedRows,
      packageActive,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── ۴. شاخص قیمت ایمچ ────────────────────────────────────────────────

  /** POST /products/getPriceIndex — عمومی؛ فقط درصد، بدون قیمت مطلق */
  async getPriceIndex() {
    const stats = await this.categoryStats();
    const top = [...stats.entries()]
      .sort((a, b) => b[1].listings - a[1].listings)
      .slice(0, INDEX_TOP);

    const categories: Array<{
      name: string;
      path: string;
      unit: string;
      sellers: number;
      listings: number;
      index: number | null;
      basis: number;
    }> = [];
    const values: number[] = [];
    for (const [catId, s] of top) {
      const leaf = await this.categories.getCategoryById(catId);
      if (!leaf) continue;
      const agg = await this.marketReport.getAggregate(leaf);
      const info = await this.marketReport.categoryInfo(leaf);
      categories.push({
        name: info.name,
        path: info.path,
        unit: info.unit,
        sellers: s.sellers,
        listings: s.listings,
        index: agg.index.value,
        basis: agg.index.basis,
      });
      if (agg.index.value != null) values.push(agg.index.value);
    }

    return {
      overall: { value: values.length ? Math.round(median(values)! * 10) / 10 : null, basis: values.length },
      categories,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── داخلی ────────────────────────────────────────────────────────────

  /** آمار دسته‌های فعال — {فروشنده، آگهی، بازدید} بر هر دستهٔ برگ؛ کش ۵ دقیقه */
  private async categoryStats(): Promise<Map<number, { sellers: number; listings: number; views: number }>> {
    return this.cache.wrap(
      'reports:category-stats',
      { ttlMs: TTL.FIVE_MIN },
      async () => {
        const pairs = await this.prisma.product.groupBy({
          by: ['subCategoryId', 'userId'],
          where: {
            status: 'confirmed',
            minSalePrice: { gt: 0 },
            ownerPaused: false,
            ...(await this.activeUsers.activeUserWhere()),
          },
          _count: { _all: true },
          _sum: { viewCount: true },
        });
        const stats = new Map<number, { sellers: number; listings: number; views: number }>();
        for (const p of pairs) {
          const cur = stats.get(p.subCategoryId) ?? { sellers: 0, listings: 0, views: 0 };
          cur.sellers += 1;
          cur.listings += p._count._all;
          cur.views += p._sum.viewCount ?? 0;
          stats.set(p.subCategoryId, cur);
        }
        return stats;
      },
    );
  }
}
