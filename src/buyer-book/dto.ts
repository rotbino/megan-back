import { IsOptional, IsString } from 'class-validator';

/**
 * DTOهای «دفتر خرید» (خواسته مالک ۱۰-۱۱ دور ۵) — قرینهٔ کاتالوگ.
 *
 * فروشنده کاتالوگ دارد که خریدار ذخیره می‌کند؛ خریدار دفتر خرید دارد
 * (کالاهای خرید دوره‌ای‌اش) که فروشنده ذخیره می‌کند — لیست مشتری بالقوه.
 * شخصی‌سازی (آیدی لینک /b/{bookId}، رنگ برند، لوگو) با updateSettings
 * ذخیره می‌شود و ذخیره/ذخیره‌کنندگان با کلید userName خریدار کار می‌کنند.
 * اعتبارسنجی کامل (قالب آیدی/رنگ/لوگو و یکتایی) در سرویس است چون پیام
 * فارسی بین اندپوینت‌ها مشترک است؛ این‌جا فقط شکل ورودی. قرارداد عین
 * استاب سندباکس (megan-web/scripts/stub-backend.mjs) و لایهٔ فرانت
 * (megan-web/src/lib/mock/api.ts + src/lib/types.ts) است.
 */

/** کلید خریدار — isSaved / toggleSave */
export class BuyerUserNameDto {
  @IsString()
  userName!: string;
}

/** آیدی عمومی — resolvePublicId / getPublic (صفحهٔ /b/{id}) */
export class ResolveBookIdDto {
  @IsString()
  id!: string;
}

/** ذخیرهٔ تنظیمات — هر فیلد اختیاری؛ فقط همان‌هایی که آمده‌اند عوض
 *  می‌شوند (ویرایش جزئی). مقادیر null/خالی = «پیش‌فرض» همان فیلد. */
export class UpdateBookSettingsDto {
  /** بخش آخر لینک عمومی — لاتین کوچک/رقم/خط تیره ۳ تا ۳۰ */
  @IsOptional()
  @IsString()
  bookId?: string | null;

  /** hex مثل #0891b2 */
  @IsOptional()
  @IsString()
  brandColor?: string | null;

  /** URL لوگوی آپلودی — حداکثر ۶۰۰ نویسه */
  @IsOptional()
  @IsString()
  logo?: string | null;
}
