/**
 * ⚠️ فایل تشخیصی موقت — بعد از ریشه‌یابی FUNCTION_INVOCATION_FAILED ورسل حذف می‌شود.
 *
 * فقط روی ورسل (VERCEL=1) فعال است. مراحل بوت، وضعیت ست‌شدن متغیرها (فقط
 * true/false — هرگز مقدار) و خطاهای مهلک را به یک وب‌هوک موقت می‌فرستد چون
 * به Runtime Logs پنل دسترسی نداریم. هیچ‌وقت خود بوت را نمی‌شکند.
 */
const BEACON_URL = 'https://webhook.site/f7eed055-07c6-4bda-aaaf-c78d945bc44f';
const enabled = !!process.env.VERCEL;

export async function beacon(
  stage: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  if (!enabled) return;
  const payload = {
    stage,
    t: new Date().toISOString(),
    node: process.version,
    cwd: process.cwd(),
    envProbe: {
      PORT: process.env.PORT ?? null,
      NODE_ENV: process.env.NODE_ENV ?? null,
      DATABASE_URL_set: !!process.env.DATABASE_URL,
      JWT_SECRET_set: !!process.env.JWT_SECRET,
      JWT_SECRET_len: process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 0,
      ARVAN_ACCESS_KEY_set: !!process.env.ARVAN_ACCESS_KEY,
    },
    ...(extra ?? {}),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fetch(BEACON_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(2500),
      });
      return;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 300)); // یک تلاش دوباره
    }
  }
}

if (enabled) {
  let crashing = false;
  process.on('uncaughtException', (err) => {
    if (crashing) return; // اولین خطا کافی است
    crashing = true;
    void beacon('uncaughtException', { err: String(err?.stack ?? err) })
      .catch(() => {})
      .finally(() => setTimeout(() => process.exit(1), 150));
  });
  process.on('unhandledRejection', (reason) => {
    if (crashing) return;
    crashing = true;
    void beacon('unhandledRejection', { err: String(reason ?? 'unknown') })
      .catch(() => {})
      .finally(() => setTimeout(() => process.exit(1), 150));
  });
}
