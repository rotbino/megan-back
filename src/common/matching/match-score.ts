/**
 * ─── فرمول امتیاز تطابق — مشترک خریدار/فروشنده ─────────────────────────────
 * (خواستهٔ مالک ۱۱-۱۱ دور ۳): ورود مستقیم از «درخواست‌های خرید من» به لیست
 * محصولات همان دسته؛ سورت پیش‌فرض «مطابق نیاز من» = نوع کالا ← تطابق حجم
 * و موجودی ← نزدیکی به شهر خریدار، و در همین شرایط امتیازِ آگهی‌های
 * نردبان‌شده و فروشندگان ویژه (پولی — دیده‌شدن) روی امتیاز می‌نشیند.
 *
 * همین توابع قبلاً به‌صورت خصوصی در BuyRequestsService (فروشندگان پیشنهادیِ
 * سمت فروشنده) زندگی می‌کردند؛ حالا اینجا منبع واحدند تا دو طرف یک فرمول
 * را ببینند.
 */

/** نرمال‌سازی متن فارسی برای مقایسه — نیم‌فاصله/فاصله‌ها یکسان و بدون سر و ته */
export const normalizeMatch = (s: string): string => s.replace(/[\u200c\s]+/g, ' ').trim();

/** امتیاز تطابق نوع کالا — نوعِ درخواستِ خریدار در نام آگهی باشد (یا برعکس) */
export const TYPE_MATCH_SCORE = 30;

/** تطبیق نوع کالا (۰ یا TYPE_MATCH_SCORE) — احتوای دوطرفه پس از نرمال‌سازی */
export function typeMatchScore(type: string | null | undefined, productName: string): number {
  const t = type ? normalizeMatch(type) : '';
  if (!t) return 0;
  const p = normalizeMatch(productName);
  return p.includes(t) || t.includes(p) ? TYPE_MATCH_SCORE : 0;
}

/** بیشینهٔ امتیاز حجم — سهم اصلی بعد از نوع */
export const VOLUME_MAX_SCORE = 25;

/**
 * امتیاز حجم (۰ تا ۲۵) — «حجم خرید نزدیک» (خواسته مالک ۷-۱۱):
 *  • نیاز خریدار داخل بازهٔ [حداقل سفارش فروشنده، موجودی فروشنده] → معامله
 *    ممکن؛ هرچه سهم بیشتری از عرضه بردارد به‌صرفه‌تر: ۱۸ + ۷×سهم
 *  • زیر حداقل سفارش → با نسبت نزدیکی به حداقل کمرنگ می‌شود
 *  • بالای موجودی → با نسبت پوشش موجودی کمرنگ می‌شود
 *  • واحد غیرقابل‌مقایسه (مثل عدد در برابر کیلوگرم) → بی‌طرف ۱۰
 */
export function volumeScore(
  buyerAmount: number,
  buyerUnit: string,
  sellerStock: number,
  sellerMin: number,
  sellerUnit: string,
): number {
  const FAMILY: Record<string, string> = {
    'تن': 'weight',
    'کیلوگرم': 'weight',
    'گرم': 'weight',
    'عدد': 'count',
    'بسته': 'pack',
    'متر': 'length',
    'لیتر': 'volume',
  };
  const parse = (v: number, unit: string): { v: number; f: string } | null => {
    const f = FAMILY[unit];
    if (!f) return null;
    if (unit === 'تن') return { v: v * 1000, f };
    if (unit === 'گرم') return { v: v / 1000, f };
    return { v, f };
  };
  const buyer = parse(buyerAmount, buyerUnit);
  const stock = parse(Math.max(1, sellerStock), sellerUnit);
  const min = parse(sellerMin, sellerUnit);
  if (!buyer || !stock || !min || buyer.f !== stock.f) return 10; // غیرقابل‌مقایسه — بی‌طرف

  if (buyer.v >= min.v && buyer.v <= Math.max(min.v, stock.v)) {
    // داخل بازهٔ معامله — خرید بزرگ‌تر از عرضهٔ فروشنده به‌صرفه‌تر
    return 18 + 7 * Math.min(1, buyer.v / stock.v);
  }
  if (buyer.v < min.v) return VOLUME_MAX_SCORE * (buyer.v / min.v) * 0.8; // زیر حداقل سفارش فروشنده
  return VOLUME_MAX_SCORE * (stock.v / buyer.v) * 0.8; // بیش از موجودی فروشنده
}

/** امتیاز مکان — هم‌شهر ۱۵ / هم‌استان ۱۰ */
export const CITY_SCORE = 15;
export const PROVINCE_SCORE = 10;

/** نزدیکی آگهی به مکان خریدار (۱۵/۱۰/۰) — مقایسهٔ عددی خام، بدون نام */
export function locationScore(
  nearProvinceId: number | undefined,
  nearCityId: number | undefined,
  productProvinceId: number,
  productCityId: number,
): number {
  if (nearCityId != null && nearCityId === productCityId) return CITY_SCORE;
  if (nearProvinceId != null && nearProvinceId === productProvinceId) return PROVINCE_SCORE;
  return 0;
}

/**
 * بوست‌های پرداختی (خواستهٔ مالک ۱۱-۱۱): آگهی نردبان‌شده و فروشندهٔ ویژه
 * «پول داده‌اند تا دیده شوند» — در سورت تطابق هم امتیازشان اضافه می‌شود،
 * اما نه بالای تیغهٔ «همان نوع» (خواستهٔ مالک: اول کالاهای همان نوع بیاید)؛
 * جمعی، نه مطلق — داخل هر تیغه حجم/نزدیکی منطبقِ قوی‌تر برنده است.
 */
export const LADDER_BOOST = 25;
export const ELEVATED_BOOST = 12;
