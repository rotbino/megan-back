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
 * ادب شبکه:
 *   • همهٔ درخواست‌ها زنجیره‌ای و فاصلهٔ BUSKOOL_DELAY_MS (پیش‌فرض ۵ ثانیه)
 *     بین هر دو درخواست — سرور باسکول بار اضافه نمی‌بیند.
 *   • retry با backoff خطی (۳ تلاش) مثل scripts/fetch-buskool-base-data.mjs.
 *   • کوکی اختیاری BUSKOOL_COOKIE — با آن متن کامل کامنت‌ها برمی‌گردد
 *     (بدون کوکی فیلد text کامنت‌ها null است).
 */

const API = 'https://www.buskool.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function buskoolConfig() {
  return {
    delayMs: Math.max(250, Number(process.env.BUSKOOL_DELAY_MS ?? 5000)),
    cookie: (process.env.BUSKOOL_COOKIE ?? '').trim(),
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** گلوِ درخواست‌ها — همهٔ فراخوانی‌ها از این صف واحد با فاصلهٔ تنظیمشده رد می‌شوند */
let chain: Promise<unknown> = Promise.resolve();

export class BuskoolClient {
  /** آخرین مهر یک درخواست موفق — برای گزارش تعداد تماس با باسکول */
  public requests = 0;
  private readonly stop: () => boolean;

  constructor(stop: () => boolean) {
    this.stop = stop;
  }

  /** درخواست زنجیره‌ای — پیش از هر فراخوانی توقف جاب و فاصلهٔ ادب رعایت می‌شود */
  call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const run = async (): Promise<T> => {
      if (this.stop()) throw new Error('JOB_STOPPED');
      const { delayMs, cookie } = buskoolConfig();
      await sleep(delayMs);
      if (this.stop()) throw new Error('JOB_STOPPED');

      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
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
          if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
          const ctype = (res.headers.get('content-type') ?? '').split(';')[0];
          if (ctype.includes('text/html')) {
            // باسکول برای اندپوینت‌های لاگین‌دار (مثل عکس پروفایل) بدون کوکی
            // به /login ریدایرکت می‌کند — پیام روشن بده نه خطای JSON parse
            throw new Error('پاسخ HTML — این اندپوینت کوکی باسکول می‌خواهد (BUSKOOL_COOKIE)');
          }
          this.requests++;
          return (await res.json()) as T;
        } catch (err) {
          lastErr = err;
          if (this.stop()) throw new Error('JOB_STOPPED');
          if (attempt < 3) await sleep(1500 * attempt);
        }
      }
      throw new Error(`buskool ${path} failed: ${(lastErr as Error)?.message ?? lastErr}`);
    };

    const result = chain.then(run, run);
    // زنجیر را حتی در صورت خطا ادامه بده — یک خطا صف را قفل نکند
    chain = result.catch(() => undefined);
    return result;
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
