/**
 * نگهبان شبکهٔ ایمپورتر (خواستهٔ مالک ۱۵-۱۱ شب) — «اینترنت من قطعی و وصلی
 * دارد؛ ایمپورت باید وقتی اینترنت قطع شد بایستد و بعد از وصل شدن از همان‌جا
 * ادامه پیدا کند».
 *
 * ایمپورتر سه وابستگی اینترنتی دارد و هر سه پشت همین نگهبان می‌ایستند:
 *   ۱) API پاسکال (فروشگاه/پروفایل/کامنت)
 *   ۲) دیتابیس Atlas (همهٔ نوشتن‌ها) + کالکشن منبع user-buskool
 *   ۳) CDN عکس‌های پاسکال + باکت ابرآروان (دانلود/آپلود تصاویر)
 *
 * سازوکار: هر خطایی که «شبکه‌ای» تشخیص داده شود (DNS، قطع سوکت، تایم‌اوت،
 * خطای اتصال Prisma و…) دیگر به‌عنوان شکستِ عملیات شمرده نمی‌شود — درخواست
 * در حافظه نگه داشته می‌شود، هر ۵ ثانیه اتصال سنجیده می‌شود و به‌محض بازگشت
 * شبکه همان عملیات از همان‌جا ادامه می‌یابد. یعنی قطعی‌های کوتاه عملاً
 * نامرئی‌اند و قطعی‌های طولانی فقط یک وقفه‌اند، نه از دست رفتن جاب.
 *
 * ایمنی: پنجرهٔ زمانی (windowMs) فقط در حالت «آنلاین ولی مقصد جواب نمی‌دهد»
 * تمام می‌شود (مثلاً پاسکال برای همیشه 502 داده باشد) — در قطعی واقعی،
 * خودِ انتظار پنجره را مصرف نمی‌کند و هرچقدر لازم باشد صبر می‌کند.
 * توقف جاب (stop) در تمام انتظارها پاس داده می‌شود و فوراً برمی‌گردد.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** فاصلهٔ سنجش اتصال هنگام قطعی — هر ۵ ثانیه یک HEAD سبک */
const PROBE_INTERVAL_MS = 5000;
/** تایم‌اوت خودِ سنجش — اگر پاسخ در ۸ ثانیه نیامد یعنی هنوز قطع است */
const PROBE_TIMEOUT_MS = 8000;
/** پیش‌فرض پنجرهٔ «آنلاین-ولی-بی‌پاسخ» برای عملیات شبکه‌ای سطح کاربر */
export const DEFAULT_NET_WINDOW_MS = 45 * 60_000;

/** نشانی سنجش — هر بار از env خوانده می‌شود (قابل‌تست)؛ هر پاسخ HTTP،
 *  هر کدی که باشد، یعنی مسیر شبکه باز است. */
function probeUrl(): string {
  return process.env.NET_PROBE_URL?.trim() || 'https://www.buskool.com/';
}

// ─── تشخیص خطای شبکه‌ای ─────────────────────────────────────────────────────

/**
 * آیا این خطا «شبکه‌ای» است؟ — یعنی با ماندن/تلاش دوباره بعد از وصل شدن
 * اینترنت احتمالاً حل می‌شود. خطاهای منطقی (HTTP 4xx/5xx پاسکال، اعتبارسنجی،
 * JOB_STOPPED) شبکه‌ای نیستند و نباید بازتلاشِ بی‌پایان شوند.
 */
export function isNetworkError(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 4; depth++) {
    // undici: TypeError: fetch failed (سوکت/DNS/…) — پرچم مطمئن شبکه
    if (e instanceof TypeError) return true;
    const any = e as { name?: string; code?: string; message?: string; cause?: unknown };

    // AbortSignal.timeout → DOMException با نام TimeoutError/AbortError
    if (any.name === 'TimeoutError' || any.name === 'AbortError') return true;

    // کدهای سیستمی Node (ایرادهای cause در undici) + خطاهای اتصال Prisma (P10xx)
    if (typeof any.code === 'string') {
      if (/^(EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR)/.test(any.code)) {
        return true;
      }
      if (/^P10/.test(any.code)) return true; // P1001/P1002/P1008/P1017 — اتصال دیتابیس
    }

    const msg = any.message ?? '';
    if (
      /fetch failed|socket hang up|network|connection (error|terminated|closed|reset|refused)|timed ?out|econnreset|enotfound|aborted/i.test(
        msg,
      )
    ) {
      return true;
    }

    e = any.cause; // undiki خطاها را در cause می‌پیچد
  }
  return false;
}

// ─── وضعیت جهانی «در انتظار شبکه» ──────────────────────────────────────────

let waiting = false;
let waitSince: number | null = null;
const listeners = new Set<(waiting: boolean, since: number | null) => void>();

/** آیا همین حالا در انتظار بازگشت شبکه هستیم؟ (برای وضعیت جاب/پنل) */
export function netWaitingNow(): boolean {
  return waiting;
}

/** از چه لحظه‌ای منتظر مانده‌ایم — null یعنی در انتظار نیستیم */
export function netWaitSince(): number | null {
  return waitSince;
}

/** ثبت شنوندهٔ گذار قطع/وصل — سرویس ایمپورتر لاگ و فیلد جاب را از اینجا می‌چیند */
export function onNetTransition(fn: (waiting: boolean, since: number | null) => void): void {
  listeners.add(fn);
}

function enterWaiting() {
  if (waiting) return;
  waiting = true;
  waitSince = Date.now();
  for (const fn of listeners) fn(true, waitSince);
}

function exitWaiting() {
  if (!waiting) return;
  waiting = false;
  waitSince = null;
  for (const fn of listeners) fn(false, null);
}

/** یک سنجش سبک — هر پاسخ HTTP از پاسکال یعنی شبکه برقرار است */
async function probeOnce(): Promise<boolean> {
  try {
    await fetch(probeUrl(), {
      method: 'HEAD',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { 'User-Agent': 'megan-importer-netwatch' },
    });
    return true; // حتی 403/405/5xx یعنی مسیر شبکه باز است
  } catch {
    return false;
  }
}

/**
 * بایست تا شبکه برگردد — قلب نگهبان. سنجش اول بلافاصله است؛ اگر شبکه
 * سالم باشد هیچ وقفه‌ای ایجاد نمی‌کند. در قطعی، هر ۵ ثانیه سنجش می‌شود و
 * با اولین پاسخ، وضعیت «در انتظار» رفع و کنترل به فراخوان برمی‌گردد.
 * اگر stop مقدار true بدهد، فوراً JOB_STOPPED پرتاب می‌شود.
 */
export async function waitForOnline(stop?: () => boolean): Promise<void> {
  try {
    for (;;) {
      if (await probeOnce()) return;
      enterWaiting();
      if (stop?.()) throw new Error('JOB_STOPPED');
      await sleep(PROBE_INTERVAL_MS);
    }
  } finally {
    exitWaiting();
  }
}

// ─── بازتلاش شبکه‌ای ────────────────────────────────────────────────────────

/**
 * عملیات را در برابر قطعی شبکه مقاوم می‌کند: خطای شبکه‌ای = توقف موقت،
 * نه شکست. بعد از بازگشت شبکه همان عملیات دوباره اجرا می‌شود (عملیات‌های
 * ایمپورتر idempotent هستند — upsert/createMany). خطای غیرشبکه‌ای عیناً
 * پرتاب می‌شود؛ JOB_STOPPED هم پاس می‌شود.
 *
 * پنجرهٔ windowMs فقط در حالت «سنجش موفق ولی عملیات مدام خطای شبکه می‌دهد»
 * تمام می‌شود — سپس خطا پرتاب می‌شود تا لایهٔ بالاتر (مثلاً قانون ۳ شکست
 * پیاپی) تصمیم بگیرد. در قطعی واقعی، انتظار هر طولانی‌باشد پنجره را
 * مصرف نمی‌کند.
 */
export async function withNetRetry<T>(
  fn: () => Promise<T>,
  opts: { stop?: () => boolean; windowMs?: number; onWait?: (err: unknown) => void } = {},
): Promise<T> {
  const windowMs = opts.windowMs ?? DEFAULT_NET_WINDOW_MS;
  let firstNetErrAt = 0;
  let announced = false;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if ((err as Error)?.message === 'JOB_STOPPED') throw err;
      if (!isNetworkError(err)) throw err;
      if (!firstNetErrAt) {
        firstNetErrAt = Date.now();
        if (!announced) {
          announced = true;
          opts.onWait?.(err);
        }
      } else if (Date.now() - firstNetErrAt > windowMs) {
        throw err; // «آنلاین ولی بی‌پاسخ» بیش از پنجره — بگذار لایهٔ بالا تصمیم بگیرد
      }
      await waitForOnline(opts.stop); // در قطعی واقعی بی‌پایان صبور است
      await sleep(1200); // یک نفس کوتاه بعد از وصل شدن
    }
  }
}
