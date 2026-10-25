/**
 * قرارداد پاسخ یکنواخت کل API:
 *   موفق:  { status: true,  data, message? }
 *   خطا:   { status: false, message, code? }  ← در AllExceptionsFilter ساخته می‌شود
 */
export function ok<T>(data: T, message?: string) {
  return message === undefined
    ? { status: true as const, data }
    : { status: true as const, data, message };
}
