import { IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PRODUCT_STATUSES, type ProductStatusKey } from '../admin-products/dto';

/**
 * گزارش آگهی‌ها بر پایهٔ تاکسونومی v2 (گروه‌بندی جدید ایمچ).
 *
 * nodeKey:
 *  • خالی/'all'   → همهٔ آگهی‌ها (نمای کلی)
 *  • 'unmapped'   → آگهی‌هایی که دستهٔ پاسکالشان هنوز به v2 نگاشت نشده
 *  • کلید v2      → مثل 'agri.pulses.chickpea' (خودش + کل زیردرخت)
 *
 * attrs: فیلتر ویژگی‌های پایلوت — { attrKey: [label, …] } — تطبیق با
 * توکن‌های نام آزاد آگهی (نرمال‌ساز فارسی + ارقام).
 */
export class GetAdsReportDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  nodeKey?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  provinceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cityId?: number;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES as unknown as string[])
  status?: ProductStatusKey;

  @IsOptional()
  @IsString()
  @Length(2, 60)
  search?: string;

  /** فقط کلید/برچسب‌های تعریف‌شده در تاکسونومی قبول می‌شود (سرویس پاک‌سازی می‌کند) */
  @IsOptional()
  @IsObject()
  attrs?: Record<string, string[]>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  perPage?: number;
}

/**
 * لیست عمومی کاتالوگ v2 — صفحهٔ عمومی /product-filter.
 *
 * تفاوت با گزارش ادمین:
 *  • فقط آگهی‌های confirmed (وضعیت دیگر قابل انتخاب نیست)؛
 *  • nodeKey فقط کلید v2 یا خالی ('unmapped' ادمینی پذیرفته نیست)؛
 *  • شماره تلفن فروشنده هرگز برنمی‌گردد؛
 *  • sort: مرتبط‌ترین (پیش‌فرض — امتیاز تطابق: شهر/استانِ کاربر واردشده +
 *    کامل بودن ویژگی‌ها + تازگی؛ امتیاز به کاربر نمایش نمی‌یابد) | جدیدترین |
 *    ارزان‌ترین | گران‌ترین | کمترین حداقل خرید | بیشترین موجودی — سورت قیمت فقط
 *    بین آگهی‌های دارای قیمت (> 0) اعمال می‌شود؛
 *  • (۲۸-۱۱ بازطراحی صفحهٔ فیلتر پیشرفته — طرح تامینان) بازهٔ قیمت و حجم
 *    خرید + فاست‌های هر گزینه (شمارش کنار فیلترها) از همین DTO می‌آیند.
 */
export class GetCatalogListDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  nodeKey?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  provinceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cityId?: number;

  @IsOptional()
  @IsString()
  @Length(2, 60)
  search?: string;

  /** فقط کلید/برچسب‌های تعریف‌شده در تاکسونومی قبول می‌شود (سرویس پاک‌سازی می‌کند) */
  @IsOptional()
  @IsObject()
  attrs?: Record<string, string[]>;

  /** کف قیمت هر واحد (تومان) — منفی یعنی دادهٔ خراب */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priceMin?: number;

  /** سقف قیمت هر واحد (تومان) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priceMax?: number;

  /** کف حداقل میزان فروش (به واحد دسته) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  moqMin?: number;

  /** سقف حداقل میزان فروش */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  moqMax?: number;

  @IsOptional()
  @IsIn(['related', 'newest', 'price-asc', 'price-desc', 'moq-asc', 'stock-desc'])
  sort?: 'related' | 'newest' | 'price-asc' | 'price-desc' | 'moq-asc' | 'stock-desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  perPage?: number;
}
