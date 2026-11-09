import { IsOptional, IsString } from 'class-validator';

/**
 * DTOهای «کاتالوگ محصول» (خواسته مالک ۱۰-۱۱).
 *
 * صفحهٔ عمومی مستقل فروشنده در /catalog/{pageId}: فروشنده با یک آیدی پیج
 * یکتا + رنگ برند + راه‌های تماس اختیاری (اینستاگرام/واتساپ) کاتالوگش را
 * می‌سازد و بعداً ویرایش می‌کند. اعتبارسنجی آیدی/رنگ/واتساپ در سرویس است
 * (چون پیام فارسی سراسری بین ساخت/ویرایش مشترک است)؛ این‌جا فقط شکل ورودی.
 */

/** آیدی پیج — هم‌قالب checkPageId / getByPageId / isSaved / toggleSave / getSavers */
export class PageIdDto {
  @IsString()
  pageId!: string;
}

/** ساخت کاتالوگ — همهٔ تنظیمات در همان لحظهٔ ساخت */
export class CreateCatalogDto {
  @IsString()
  pageId!: string;

  /** hex مثل #0f766e — خالی/نامعتبر = رنگ پیش‌فرض یشمی */
  @IsOptional()
  @IsString()
  brandColor?: string;

  /** آیدی اینستاگرام — @ و آدرس کامل سمت سرور کاندیده می‌شود */
  @IsOptional()
  @IsString()
  instagramId?: string | null;

  /** 09xxxxxxxxx — ارقام فارسی/۰۰/۹۸+ نرمال می‌شود */
  @IsOptional()
  @IsString()
  whatsappNumber?: string | null;
}

/** ویرایش تنظیمات — هر فیلد اختیاری؛ فقط همان‌هایی که آمده‌اند عوض می‌شوند */
export class UpdateCatalogDto {
  @IsOptional()
  @IsString()
  pageId?: string;

  @IsOptional()
  @IsString()
  brandColor?: string;

  @IsOptional()
  @IsString()
  instagramId?: string | null;

  @IsOptional()
  @IsString()
  whatsappNumber?: string | null;
}
