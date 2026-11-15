/**
 * بازهٔ تاریخ برای $match در $runCommandRaw (خواستهٔ مالک ۱۵-۱۱: فیلتر بازهٔ
 * زمانی ثبت/آپدیت در صفحات دیتا-ایمپورت).
 *
 * فیلدهای created_at/updated_at در مونگو BSON Date هستند؛ رشتهٔ ISO خام در
 * $match با آن‌ها مچ نمی‌شود (کنترل شد: نتیجهٔ خالی). راه درست EJSON است:
 *   { created_at: { $gte: { $date: "…" }, $lte: { $date: "…" } } }
 * (تست‌شده روی کلاستر واقعی — شمارش یکسان با الگوی $expr+$toDate که در
 * imported-users.service استفاده شده بود؛ این شکل index-friendly هم هست).
 */

export type MongoDateRange = Record<string, unknown> | null;

/** بازهٔ {$gte,$lte} از دو ISO اختیاری — هر طرف مستقل می‌تواند خالی باشد */
export function mongoDateRange(from?: string | null, to?: string | null): MongoDateRange {
  const range: Record<string, unknown> = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) range.$gte = { $date: d.toISOString() };
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) range.$lte = { $date: d.toISOString() };
  }
  return Object.keys(range).length > 0 ? range : null;
}
