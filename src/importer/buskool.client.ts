/**
 * کلاینت API عمومی باسکول — تنها لایهٔ تماس ایمپورتر با buskool.com.
 *
 * اندپوینت‌ها (برگرفته از مهندسی معکوس app-live.js و chunks، ۱۲-۱۱):
 *   POST /load_profile_by_user_name        {user_name}
 *   POST /get_user_statistics_by_user_name {user_name}
 *   POST /get_user_last_confirmed_profile_photo {user_id}
 *   POST /profile/get-user-comments        {user_id}
 *   POST /get_product_list_by_user_name    {user_name, status:2, is_public:true,
 *                                           from_record_number, to_record_number}
 *   POST /get_product_by_id                {product_id}
 *
 * ادب شبکه (بازطراحی سرعت ۱۴-۱۱ — خواستهٔ مالک: سریع‌تر، بدون بلاک شدن):
 *   • به‌جای زنجیرهٔ ترتیبیِ «درخواست بعدی فقط بعد از پایان قبلی + ۵ ثانیه»،
 *     یک «گیت نرخ» سراسری: فاصلهٔ حداقلی بین «شروع» دو درخواست
 *     (BUSKOOL_DELAY_MS، پیش‌فرض ۵۰۰ms) + حداکثر BUSKOOL_CONCURRENCY
 *     درخواست هم‌زمان در پرواز (پیش‌فرض ۴). الگوی بار دقیقاً مثل یک
 *     مرورگر واقعی است که چند XHR موازی می‌زند — برای باسکول هم عادی‌تر
 *     و هم چند برابر سریع‌تر از قبل است.
 *   • عقب‌نشینی تطبیقی: با اولین نشانهٔ محدودیت (HTTP 429/403) فاصلهٔ
 *     مؤثر به‌صورت نمایی زیاد می‌شود (تا ۱۰ برابر) و با هر موفقیت آرام
 *     به حالت عادی برمی‌گردد — یعنی هرگز «به‌انگازانه» به سرور فشار
 *     نمی‌آید و خودش را از بلاک خارج می‌کند.
 *   • retry با backoff خطی (۳ تلاش) مثل scripts/fetch-buskool-base-data.mjs.
 *   • کوکی اختیاری BUSKOOL_COOKIE — سنجش زندهٔ ۱۵-۱۱: قیمت‌ها و متنِ
 *     کامنت‌های confirmed=1 کاملاً عمومی‌اند و بدون هیچ کوکی‌ای برمی‌گردند؛
 *     فقط متنِ کامنت‌های confirmed=0 پشت سنجش لاگین است — کوکی «مهمان»
 *     پذیرفته می‌شود ولی چیزی باز نمی‌کند (GET /api/user → 401).
 */

const API = 'https://www.buskool.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** محدودهٔ مجاز فاصلهٔ شروع درخواست‌ها — حتی اگر env مقدار بزرگ‌تر بدهد
 *  (مثل BUSKOOL_DELAY_MS=5000 قدیمی)، سقف ۱۲۰۰ms اعمال می‌شود تا سرعت
 *  پیش‌فرض پروژه همیشه برقرار بماند. */
const GAP_MIN_MS = 200;
const GAP_MAX_MS = 1200;
const GAP_DEFAULT_MS = 500;
/** سقف هم‌زمانی درخواست‌های در پرواز به باسکول */
const CONCURRENCY_DEFAULT = 4;
const CONCURRENCY_MAX = 8;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function buskoolConfig() {
  const raw = Number(process.env.BUSKOOL_DELAY_MS ?? GAP_DEFAULT_MS);
  const gap = Number.isFinite(raw) ? raw : GAP_DEFAULT_MS;
  const rawC = Number(process.env.BUSKOOL_CONCURRENCY ?? CONCURRENCY_DEFAULT);
  const concurrency = Number.isFinite(rawC) ? rawC : CONCURRENCY_DEFAULT;
  return {
    // فاصلهٔ حداقلی بین «شروع» دو درخواست — نه انتظار برای پایان قبلی
    delayMs: Math.min(Math.max(gap, GAP_MIN_MS), GAP_MAX_MS),
    concurrency: Math.min(Math.max(Math.floor(concurrency), 1), CONCURRENCY_MAX),
    cookie: (process.env.BUSKOOL_COOKIE ?? '').trim(),
  };
}

// ─── عقب‌نشینی تطبیقی (ماژول-سطح؛ سرور زنده/گرم بین جاب‌ها حفظ می‌شود) ────────

/** ضریب ادب جاری — ۱ یعنی سرعت عادی؛ با 429/403 نمایی بالا می‌رود (تا ۱۰)
 *  و با هر پاسخ موفق آرام (۰٫۸۵×) برمی‌گردد. */
let pacePenalty = 1;
const PENALTY_MAX = 10;
const EFFECTIVE_GAP_MAX_MS = 12_000;

function effectiveGapMs(): number {
  const { delayMs } = buskoolConfig();
  return Math.min(Math.round(delayMs * pacePenalty), EFFECTIVE_GAP_MAX_MS);
}

/** وضعیت گام فعلی — برای ping و مشاهدهٔ زندهٔ رفتار ایمپورتر */
export function buskoolPace() {
  const { delayMs, concurrency } = buskoolConfig();
  return {
    gapMs: delayMs,
    effectiveGapMs: effectiveGapMs(),
    concurrency,
    penalty: Math.round(pacePenalty * 100) / 100,
  };
}

// ─── سلامت سشن: اصلاً لاگین است؟ (کشف ۱۵-۱۱) ─────────────────────────────
//
// کوکیِ «مهمان» هم از سمت باسکول پذیرفته می‌شود (همان id با انقضای تمدیدشده
// برمی‌گردد) ولی هیچ چیزی را باز نمی‌کند — متن کامنت‌های confirmed=0 هم
// null می‌ماند و already_liked هم null است. سنجش قطعی: GET /api/user —
// سشن لاگین‌شده 200 می‌گیرد، مهمان 401 Unauthenticated.
//
// کش ماژول-سطح با کلیدِ مقدار کوکی: کوکی فقط با ری‌استارت عوض می‌شود، پس
// در عمل یک تماس در عمر پروسه (+ تلاش مجدد فقط اگر شبکه خطا داد).

let sessionProbe: { cookie: string; p: Promise<boolean | null> } | null = null;

/** آیا کوکی تنظیم‌شده سشنِ لاگین‌شده است؟
 *  true = لاگین، false = مهمان/بی‌اثر، null = کوکی خالی یا خطای شبکه */
export function buskoolSessionLoggedIn(): Promise<boolean | null> {
  const { cookie } = buskoolConfig();
  if (!cookie) return Promise.resolve(false);
  if (sessionProbe?.cookie === cookie) return sessionProbe.p;
  const p = (async (): Promise<boolean | null> => {
    try {
      const res = await fetch(`${API}/api/user`, {
        headers: {
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/plain, */*',
          Referer: `${API}/`,
          Cookie: cookie,
        },
        signal: AbortSignal.timeout(10_000),
      });
      return res.status !== 401;
    } catch {
      sessionProbe = null; // تلاش مجدد در سنجش بعدی
      return null;
    }
  })();
  sessionProbe = { cookie, p };
  return p;
}

// ─── گیت نرخ سراسری ─────────────────────────────────────────────────────────
//
// تضمین می‌کند: (۱) بین «شروع» دو درخواست حداقل فاصلهٔ مؤثر فاصله باشد،
// (۲) هم‌زمان حداکثر N درخواست در پرواز باشد. برخلاف زنجیرهٔ قبلی،
// انتظارِ شبکهٔ درخواست‌های قبلی جلوی شروعِ بعدی‌ها را نمی‌گیرد.

class PaceGate {
  private active = 0;
  private nextStart = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly waiters: Array<() => void> = [];

  private tryStart(): boolean {
    const { concurrency } = buskoolConfig();
    if (this.active >= concurrency) return false;
    const now = Date.now();
    if (now < this.nextStart) return false;
    this.nextStart = now + effectiveGapMs();
    this.active++;
    return true;
  }

  private pump(): void {
    while (this.waiters.length && this.tryStart()) this.waiters.shift()!();
    // اگر منتظرِ فاصلهٔ زمانی هستیم، تایمر بگذار (در محیط serverlessِ فریز-و-ادامه
    // هم درست کار می‌کند — تایمنِ گذشته بلافاصله بعد از thaw فایر می‌شود)
    if (this.waiters.length && !this.timer) {
      const wait = Math.max(5, this.nextStart - Date.now() + 5);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, wait);
    }
  }

  async acquire(): Promise<void> {
    if (this.tryStart()) return;
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.pump();
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    this.pump();
  }
}

/** گیت مشترک همهٔ جاب‌ها — ایمپورتر تک‌جاب است، پس یک صف واحد کافی است */
const gate = new PaceGate();

export class BuskoolClient {
  /** آخرین مهر یک درخواست موفق — برای گزارش تعداد تماس با باسکول */
  public requests = 0;
  private readonly stop: () => boolean;

  constructor(stop: () => boolean) {
    this.stop = stop;
  }

  /** درخواست با گیت نرخ — پیش از هر تلاش توقف جاب بررسی و فاصلهٔ ادب رعایت می‌شود */
  async call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    let lastErr: unknown;

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (this.stop()) throw new Error('JOB_STOPPED');
      await gate.acquire();
      let released = false;
      try {
        const { cookie } = buskoolConfig();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/plain, */*',
          Origin: API,
          Referer: `${API}/`,
        };
        if (cookie) headers.Cookie = cookie;

        const res = await fetch(`${API}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
          redirect: 'follow',
        });
        if (res.status === 429 || res.status === 403) {
          // نشانهٔ محدودسازی — عقب‌نشینی نمایی؛ شاید درخواست بعدی بلافاصله رد شود
          pacePenalty = Math.min(pacePenalty * 2, PENALTY_MAX);
          throw new Error(`HTTP ${res.status} on ${path} (backoff ×${Math.round(pacePenalty)})`);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
        const ctype = (res.headers.get('content-type') ?? '').split(';')[0];
        if (ctype.includes('text/html')) {
          // باسکول برای اندپوینت‌های لاگین‌دار (مثل عکس پروفایل) بدون کوکی
          // به /login ریدایرکت می‌کند — پیام روشن بده نه خطای JSON parse
          throw new Error('پاسخ HTML — این اندپوینت کوکی باسکول می‌خواهد (BUSKOOL_COOKIE)');
        }
        this.requests++;
        // پاسخ سالم — آرام به سرعت عادی برگرد
        pacePenalty = Math.max(1, pacePenalty * 0.85);
        return (await res.json()) as T;
      } catch (err) {
        lastErr = err;
        gate.release();
        released = true;
        if (this.stop()) throw new Error('JOB_STOPPED');
        if (attempt < 3) await sleep(1500 * attempt * Math.min(pacePenalty, 4));
      } finally {
        if (!released) gate.release();
      }
    }
    throw new Error(`buskool ${path} failed: ${(lastErr as Error)?.message ?? lastErr}`);
  }
}

// ─── تایپ‌های پاسخ (فقط فیلدهای مصرفی) ─────────────────────────────────────

/** عنوان بستهٔ باسکول از کد active_pakage_type — همان نگاشت پکیج‌های آیمچ
 *  (۰=رایگان ۱=دوماهه ۲=شش‌ماهه ۳=یک‌ساله)؛ فقط برای «نمایش» در داده‌های b */
export const BK_PACKAGE_TITLES: Record<number, string> = {
  0: 'رایگان',
  1: 'دوماهه',
  2: 'شش‌ماهه',
  3: 'یک‌ساله',
};

export interface BkProfileResp {
  profile: {
    id: number;
    description: string | null;
    activity_domain: string | null;
    /** URL مستقیم عکس پروفایل — در پاسخ load_profile_by_user_name (نمونهٔ
     *  مالک ۱۳-۱۱)؛ منبع اصلی آواتار ایمپورتر است */
    profile_photo: string | null;
    address: string | null;
    postal_code?: string | null;
    is_company: number;
    company_name: string | null;
    company_register_code?: string | null;
    confirmed: number;
    myuser_id: number;
  } | null;
  user_info: {
    id: number;
    created_at: string;
    user_name: string;
    first_name: string;
    last_name: string;
    sex: string | null;
    province: string | null;
    city: string | null;
    /** «1»=تولیدی/… (رشتهٔ عددی باسکول) */
    activity_type?: string | null;
    is_verified: number;
    is_buyer: number;
    is_seller: number;
    is_blocked?: number;
    wallet_balance?: number;
    phone_view_permission?: string;
    category_id?: number | null;
    active_pakage_type: number;
    customer_status?: string;
    support_status?: string;
    coming_from?: string | null;
  };
  /** عکس‌های مرتبط — آرایهٔ URL رشته‌ای (نمونهٔ مالک ۱۳-۱۱)؛ برای سازگاری
   *  با پاسخ‌های قدیمی، شکل {name} هم پذیرفته می‌شود */
  relateds?: (string | { name?: string })[];
  /** دامنهٔ فعالیت به‌صورت نام (مثل «تنقلات و شیرینی») — بالاتر از profile */
  activity_domain?: string | null;
  /** ibp باسکول (نمونهٔ مالک: false) — سوابق رفتاری، عیناً ذخیره می‌شود */
  ibp?: boolean;
  certificates?: unknown[];
  meta?: unknown[];
}

export interface BkStatsResp {
  status: boolean;
  statistics: {
    user_info: {
      active_package_type: number;
      response_rate: number;
      products_count: number;
      reputation_score: string;
      is_verified: number;
    };
    rating_info: { total_count: number; avg_rating_score: number };
  } | null;
}

export interface BkCommentsResp {
  status: boolean;
  comments: {
    user_id: number;
    first_name: string;
    last_name: string;
    city: string | null;
    province: string | null;
    c_id: number;
    created_at: string;
    text: string | null;
    rating_score: number;
    confirmed: number;
  }[];
  rating: { total_count: number; avg_score: number };
}

export interface BkProductItem {
  main: {
    id: number;
    updated_at: string;
    p_created_at: string;
    product_name: string;
    stock: number;
    min_sale_price: number;
    min_sale_amount: number;
    description: string;
    myuser_id: number;
    sub_category_id: number;
    confirmed: number;
    province_id: number;
    city_id: number;
    sub_category_name: string;
    unit: string;
    is_rejected: number;
    deleted_at: string | null;
    category_id: number;
    category_name: string;
    has_video: boolean;
    is_elevated: number;
    last_price_update: string;
  };
  user_info: { id: number; user_name: string };
}

export interface BkProductListResp {
  products: BkProductItem[];
}

export interface BkProductDetailResp {
  status: boolean;
  product: {
    main: BkProductItem['main'];
    photos: { file_path: string; status: string; mime: number; upload_date: string }[];
  };
}

export interface BkAvatarResp {
  status?: boolean;
  profile_photo: string | { file_path?: string; url?: string } | null;
}
