/**
 * ─── تاکسونومی v2 — زیرساخت نگاشت مشترک «باسکول پشت صحنه / ایمچ صحنه» ───
 *
 * تصمیم مالک (۲۶-۱۱): دسته‌بندی نمای سایت از درخت اختصاصی ایمچ
 * (TAXONOMY_V2_ROOTS) می‌آید؛ دستهٔ پاسکال/باسکول روی آگهی‌ها می‌ماند
 * (ایمپورت + تطابق + گزارش‌های ادمین) ولی هرگز در ظاهر سایت دیده نمی‌شود.
 * هر آگهی عملاً «هر دو دسته» را دارد: شناسهٔ باسکول روی رکورد + کلید v2
 * که از همین جدول استاتیک در لحظهٔ خواندن مشتق می‌شود (متریالایز در
 * خواندن — بدون ستون دیتابیس و بدون مهاجرت؛ پوشش ۶۹۵/۶۹۵ دستهٔ باسکول).
 *
 * این ماژول «بدون وابستگی به Nest» است تا هر سرویسی (products/city-market/
 * buy-requests/buyer-book/catalog-v2) آن را مستقیم import کند.
 */

import { BUSKOL_NAME_TO_V2, BUSKOL_TO_V2 } from '../admin/ads-report/buskol-map.generated';
import { findTaxonomyNode, taxonomyPath } from '../admin/ads-report/taxonomy-v2';

// ─── نرمال‌سازی فارسی — هم‌ارغ ads-report.service (منبع واحد در common) ──────

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

// ─── معکوس نگاشت استاتیک (پیش‌محاسبه یک‌بار در بوت ماژول) ────────────────────

/** کلید v2 → همهٔ idهای باسکول زیر همان گره (خودش + همهٔ اجدادش در نگاشت) */
const keyToBuskolIds = new Map<string, number[]>();
/** همهٔ idهای باسکول دارای نگاشت (برای گزارش unmapped) */
const mappedBuskolIds = new Set<number>();

for (const [bId, key] of Object.entries(BUSKOL_TO_V2)) {
  const id = Number(bId);
  mappedBuskolIds.add(id);
  const chain = key.split('.');
  for (let i = 1; i <= chain.length; i++) {
    const k = chain.slice(0, i).join('.');
    const list = keyToBuskolIds.get(k) ?? [];
    list.push(id);
    keyToBuskolIds.set(k, list);
  }
}

/** آیا این مقدار یک کلید v2 معتبر است؟ (کلیدها ASCII نقطه‌گذرند و هرگز
 *  با slug/نام فارسی باسکول تصادم نمی‌کنند — پارامتر categorySlug سایت
 *  بدون تغییر، مقدارش کلید v2 می‌شود) */
export function isTaxonomyKey(value: string | undefined | null): value is string {
  return Boolean(value) && findTaxonomyNode(value as string) !== null;
}

/** idهای باسکولِ زیر یک کلید v2 — خالی یعنی «گره بدون آگهی»، undefined یعنی کلید نامعتبر */
export function buskolIdsForKey(key: string): number[] | undefined {
  return keyToBuskolIds.get(key);
}

/** همهٔ idهای دارای نگاشت (عمومی برای گزارش‌ها) */
export function mappedBuskolIdSet(): ReadonlySet<number> {
  return mappedBuskolIds;
}

/** resolve یک دستهٔ باسکول → کلید v2 (اول id، بعد نام — مقاوم در برابر
 *  دسته‌های تازهٔ ایمپورت‌شده که در نگاشت id نیستند) */
export function v2KeyForBuskol(buskolId: number, buskolName?: string | null): string | null {
  const byId = BUSKOL_TO_V2[buskolId];
  if (byId) return byId;
  if (buskolName) return BUSKOL_NAME_TO_V2[normalizeFa(buskolName)] ?? null;
  return null;
}

/** مسیر نام‌های v2 برای یک دستهٔ باسکول — مثل [کشاورزی و باغبانی، حبوبات، نخود] */
export function v2PathForBuskol(buskolId: number, buskolName?: string | null): string[] {
  const key = v2KeyForBuskol(buskolId, buskolName);
  return key ? taxonomyPath(key) : [];
}

/** مسیر نام‌های v2 برای یک کلید — خالی برای کلید نامعتبر */
export function v2PathForKey(key: string | null | undefined): string[] {
  return key && isTaxonomyKey(key) ? taxonomyPath(key) : [];
}
