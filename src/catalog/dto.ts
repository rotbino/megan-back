import { IsOptional, IsString } from 'class-validator';

/**
 * DTOهای «کاتالوگ کاربر» (خواسته مالک ۱۰-۱۱ + بازنگری دور ۲/۳).
 *
 * کاتالوگ فروشنده همان صفحهٔ عمومی اوست (/c/{catalogId}) — ساخت/ویرایش
 * جداگانه ندارد؛ شخصی‌سازی (آیدی لینک، نام برند، رنگ، آیکون) با
 * updateSettings ذخیره می‌شود و ذخیره/ذخیره‌کنندگان با کلید userName
 * فروشنده کار می‌کنند. اعتبارسنجی کامل (قالب آیدی/رنگ/آیکون و یکتایی)
 * در سرویس است چون پیام فارسی بین اندپوینت‌ها مشترک است؛ این‌جا فقط
 * شکل ورودی. قرارداد عین استاب سندباکس (megan-web/scripts/stub-backend.mjs)
 * و لایهٔ فرانت (megan-web/src/lib/mock/api.ts) است.
 */

/** کلید فروشنده — isSaved / toggleSave / getSavers */
export class UserNameDto {
  @IsString()
  userName!: string;
}

/** آیدی عمومی — resolvePublicId (صفحهٔ /c/{id}) */
export class ResolveIdDto {
  @IsString()
  id!: string;
}

/** ذخیرهٔ تنظیمات — هر فیلد اختیاری؛ فقط همان‌هایی که آمده‌اند عوض
 *  می‌شوند (ویرایش جزئی). مقادیر null/خالی = «پیش‌فرض» همان فیلد. */
export class UpdateSettingsDto {
  /** بخش آخر لینک عمومی — لاتین کوچک/رقم/خط تیره ۳ تا ۳۰ */
  @IsOptional()
  @IsString()
  catalogId?: string | null;

  /** نام برند/فروشگاه — حداکثر ۴۰ نویسه */
  @IsOptional()
  @IsString()
  brandName?: string | null;

  /** hex مثل #0e9f6e */
  @IsOptional()
  @IsString()
  brandColor?: string | null;

  /** کلید آیکون از فهرست رسمی فرانت (lib/catalog-brand) */
  @IsOptional()
  @IsString()
  brandIcon?: string | null;
}
