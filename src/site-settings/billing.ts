/**
 * ─── پیکربندی صورتحساب ایمچ — تک منبع حقیقت هزینه‌ها ─────────────────────────
 *
 * خواسته مالک (۳۱-۱۰): «همه هزینه‌ها/درصدها/سقف‌ها از پنل ادمین قابل تغییر
 * باشند؛ هیچ عددی در کد hardcode نماند» — این فایل فقط «پیش‌فرض‌ها» و
 * «نرمال‌سازی/اعتبارسنجی» ورودی ادمین را دارد. مقادیر زنده از سند
 * SiteSetting (id=main) خوانده می‌شوند؛ اولین خواندن سند را با همین
 * پیش‌فرضها می‌سازد تا رفتار سایت بدون هیچ تغییری ادامه یابد.
 */

/** ردیف پکیج شارژ کیف پول (کارت‌به‌کارت) */
export interface ChargePackageRow {
  key: string;
  amount: number;
  bonusPercent: number;
}

/** قواعد شارژ دلخواه (دکمه «سایر») — پله‌های درصد شارژ اضافه */
export interface CustomChargeRules {
  /** سقف منطقی — جلوگیری از اشتباه سه‌رقمی در فیش */
  maxAmount: number;
  /** پله‌ها صعودی بر اساس aboveAmount؛ درصدِ آخرین پله‌ای که amount از aboveAmount
   *  آن «بیشتر» باشد اعمال می‌شود. [0→30٪, 1M→50٪] یعنی تا ۱ میلیون ۳۰٪ و
   *  بالاتر از آن ۵۰٪ (عین رفتار پیشین). */
  tiers: { aboveAmount: number; percent: number }[];
}

/** نردبان آگهی */
export interface LadderConfig {
  monthlyPrice: number;
  maxMonths: number;
}

/** پیشنهاد تامین — سقف روزانه به تفکیک سطح بسته فعال فروشنده */
export interface SupplyOfferConfig {
  /** سقف تکی‌ارسال به‌ازای هر سطح (pakageType) در شبانه‌روز */
  dailyLimits: { pakageType: number; label: string; limit: number }[];
}

/** ارسال گروهی پیشنهاد تامین — پولی از کیف پول */
export interface GroupSendConfig {
  /** هزینه هر گیرنده (تومان) */
  perRecipientPrice: number;
  /** سقف کل گیرندگان گروهی در شبانه‌روز (ضد هرزنامه) */
  maxPerDay: number;
  /** سقف هر ارسال (اندازه دسته) */
  maxBatch: number;
}

/** کل پیکربندی صورتحساب — شکل JSON در SiteSetting.data */
export interface BillingConfig {
  chargePackages: ChargePackageRow[];
  customCharge: CustomChargeRules;
  ladder: LadderConfig;
  supplyOffer: SupplyOfferConfig;
  groupSend: GroupSendConfig;
}

/** پیش‌فرض‌ها — عین مقادیر hardcode قبلی (مهاجرت بدون تغییر رفتار) */
export const DEFAULT_BILLING: BillingConfig = {
  chargePackages: [
    { key: 'p100', amount: 100_000, bonusPercent: 0 },
    { key: 'p200', amount: 200_000, bonusPercent: 10 },
    { key: 'p400', amount: 400_000, bonusPercent: 20 },
  ],
  customCharge: {
    maxAmount: 100_000_000,
    tiers: [
      { aboveAmount: 0, percent: 30 },
      { aboveAmount: 1_000_000, percent: 50 },
    ],
  },
  ladder: { monthlyPrice: 50_000, maxMonths: 4 },
  supplyOffer: {
    dailyLimits: [
      { pakageType: 1, label: 'دو ماهه', limit: 5 },
      { pakageType: 2, label: 'شش ماهه', limit: 10 },
      { pakageType: 3, label: 'یک‌ساله', limit: 20 },
    ],
  },
  groupSend: { perRecipientPrice: 5_000, maxPerDay: 100, maxBatch: 50 },
};

/** درصد شارژ اضافه مبلغ دلخواه — از پله‌های پیکربندی‌شده (dynamic) */
export function customBonusPercent(amount: number, tiers: CustomChargeRules['tiers']): number {
  let percent = 0;
  for (const t of tiers) {
    if (amount > t.aboveAmount) percent = t.percent;
  }
  return percent;
}

/** حداقل شارژ دلخواه = مبلغ گران‌ترین پکیج شارژ (خواسته مالک ۳۱-۱۰:
 *  جایگزین حد ۴۰۰ هزار ثابت). اگر پکیجی نبود، ۱۰۰ هزار. */
export function customChargeMin(cfg: BillingConfig): number {
  return cfg.chargePackages.reduce((m, p) => Math.max(m, p.amount), 0) || 100_000;
}

// ─── نرمال‌سازی ورودی ادمین ──────────────────────────────────────────────────

const KEY_RE = /^[a-z0-9_]{1,20}$/;

function toInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normChargePackages(raw: unknown): ChargePackageRow[] {
  if (!Array.isArray(raw)) return DEFAULT_BILLING.chargePackages;
  const rows: ChargePackageRow[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const key = String(o.key ?? '').trim();
    if (!KEY_RE.test(key) || seen.has(key)) continue;
    const amount = toInt(o.amount, 0, 10_000, 1_000_000_000);
    if (amount <= 0) continue;
    rows.push({ key, amount, bonusPercent: toInt(o.bonusPercent, 0, 0, 100) });
    seen.add(key);
  }
  if (rows.length === 0) return DEFAULT_BILLING.chargePackages;
  return rows.sort((a, b) => a.amount - b.amount).slice(0, 8);
}

function normCustomCharge(raw: unknown): CustomChargeRules {
  const d = DEFAULT_BILLING.customCharge;
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  const maxAmount = toInt(o.maxAmount, d.maxAmount, 1_000_000, 10_000_000_000);
  let tiers: CustomChargeRules['tiers'] = [];
  if (Array.isArray(o.tiers)) {
    for (const t of o.tiers) {
      if (!t || typeof t !== 'object') continue;
      const to = t as Record<string, unknown>;
      tiers.push({
        aboveAmount: toInt(to.aboveAmount, 0, 0, 10_000_000_000),
        percent: toInt(to.percent, 0, 0, 100),
      });
    }
    tiers.sort((a, b) => a.aboveAmount - b.aboveAmount);
    // پله اول باید از ۰ شروع شود تا هر مبلغی درصدی داشته باشد
    if (tiers.length === 0 || tiers[0].aboveAmount > 0) {
      tiers = [{ aboveAmount: 0, percent: tiers[0]?.percent ?? 0 }, ...tiers];
    }
    tiers = tiers.slice(-6); // حداکثر ۶ پله — بیش از این فقط ادمین را گیج می‌کند
  } else {
    tiers = d.tiers;
  }
  return { maxAmount, tiers };
}

function normLadder(raw: unknown): LadderConfig {
  const d = DEFAULT_BILLING.ladder;
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  return {
    monthlyPrice: toInt(o.monthlyPrice, d.monthlyPrice, 1_000, 100_000_000),
    maxMonths: toInt(o.maxMonths, d.maxMonths, 1, 12),
  };
}

function normSupplyOffer(raw: unknown): SupplyOfferConfig {
  const d = DEFAULT_BILLING.supplyOffer;
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const limits = o && Array.isArray(o.dailyLimits) ? o.dailyLimits : null;
  if (!limits) return d;
  const rows: SupplyOfferConfig['dailyLimits'] = [];
  const seen = new Set<number>();
  for (const r of limits) {
    if (!r || typeof r !== 'object') continue;
    const ro = r as Record<string, unknown>;
    const pakageType = toInt(ro.pakageType, 0, 1, 9);
    if (pakageType <= 0 || seen.has(pakageType)) continue;
    rows.push({
      pakageType,
      label: String(ro.label ?? '').trim() || `سطح ${pakageType}`,
      limit: toInt(ro.limit, 5, 0, 1_000),
    });
    seen.add(pakageType);
  }
  if (rows.length === 0) return d;
  return { dailyLimits: rows.sort((a, b) => a.pakageType - b.pakageType) };
}

function normGroupSend(raw: unknown): GroupSendConfig {
  const d = DEFAULT_BILLING.groupSend;
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  return {
    perRecipientPrice: toInt(o.perRecipientPrice, d.perRecipientPrice, 0, 100_000_000),
    maxPerDay: toInt(o.maxPerDay, d.maxPerDay, 1, 10_000),
    maxBatch: toInt(o.maxBatch, d.maxBatch, 1, 500),
  };
}

/** اعتبارسنجی + نرمال‌سازی کل پیکربندی — ورودی ادمین هرگز خام ذخیره نمی‌شود */
export function normalizeBilling(raw: unknown): BillingConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    chargePackages: normChargePackages(o.chargePackages),
    customCharge: normCustomCharge(o.customCharge),
    ladder: normLadder(o.ladder),
    supplyOffer: normSupplyOffer(o.supplyOffer),
    groupSend: normGroupSend(o.groupSend),
  };
}

/** سقف روزانه پیشنهاد تامین برای سطح بسته — سطح ناشناخته → کم‌طول‌ترین سقف
 *  (محافظه‌کارانه ضد هرزنامه) */
export function offerDailyLimit(cfg: BillingConfig, pakageType: number): number {
  const row = cfg.supplyOffer.dailyLimits.find((r) => r.pakageType === pakageType);
  if (row) return row.limit;
  return cfg.supplyOffer.dailyLimits.reduce((m, r) => Math.min(m, r.limit), 0);
}
