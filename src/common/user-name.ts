/**
 * تولید یوزرنیم عمومی آیمچ — مشترک بین ثبت‌نام (auth) و ایمپورتر باسکول.
 *
 * قاعدهٔ هویت (خواستهٔ مالک ۲۰-۱۱): یوزرنیم آیمچ کاربر هرگز نباید با یوزرنیم
 * او در باسکول یکی باشد — یوزرنیم باسکول در bUserName نگه داشته می‌شود و
 * یوزرنیم آیمچ (این فیلد) همیشه شناسه‌ای تصادفی و مستقل است؛ برای کاربران
 * ایمپورت‌شده هم همین سازنده مقدار تصادفی می‌سازد.
 */
import { randomBytes } from 'node:crypto';
import type { PrismaService } from './prisma/prisma.module';

/** شناسهٔ عمومی پروفایل مثل باسکول (wbrstu2g1) — بدون حروف گیج‌کننده */
const USERNAME_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function generateUserName(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => USERNAME_ALPHABET[b % USERNAME_ALPHABET.length]).join('');
}

/**
 * یوزرنیم یکتا — ۵ تلاش تصادفی + پسوند زمانی به‌عنوان پشتیبان.
 * `avoid` (اختیاری): مقداری که نباید برگردد (مثلاً یوزرنیم باسکول همان کاربر
 * تا قاعدهٔ «آیمچ ≠ باسکول» حتی در بدشانسیِ تصادف هم نقض نشود).
 */
export async function uniqueUserName(
  prisma: PrismaService,
  avoid?: string | null,
): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const candidate = generateUserName();
    if (avoid && candidate === avoid) continue;
    const exists = await prisma.user.findUnique({ where: { userName: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  let fallback = `${generateUserName()}${Date.now().toString(36)}`;
  if (avoid && fallback === avoid) fallback += 'x';
  return fallback;
}
