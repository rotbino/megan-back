/**
 * هش رمز عبور — scrypt از node:crypto (بدون وابستگی جدید؛ مثل bcrypt قوی).
 * قالب ذخیره: `scrypt:<salt-base64url>:<key-base64>` — verify با timingSafeEqual.
 *
 * کاربرد:
 *  - رمز اختیاری پنل کاربر (User.passwordHash) — تعیین‌شده از بنر قرمز پنل
 *  - ورود ادمین‌ها (AdminUser.passwordHash)
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 64;

/** رمز → رشته هش قابل ذخیره */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const key = (await scryptAsync(plain.normalize('NFKC'), salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt}:${key.toString('base64')}`;
}

/** تطبیق رمز با هش ذخیره‌شده — همیشه false در قالب خراب (بدون throw) */
export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    const [scheme, salt, hash] = stored.split(':');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const key = (await scryptAsync(plain.normalize('NFKC'), salt, KEY_LENGTH)) as Buffer;
    return timingSafeEqual(key, Buffer.from(hash, 'base64'));
  } catch {
    return false;
  }
}
