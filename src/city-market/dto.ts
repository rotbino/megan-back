import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * POST /cityMarket/getProducts — ورودی بازار عمدهٔ شهری (خواستهٔ مالک ۹-۱۱).
 *
 * قرارداد عین getProductList است به‌جز اینکه به‌جای provinceId/cityId واحد،
 * آرایهٔ cityIds می‌گیرد: شهر خودِ صفحه (ثابت) + شهرهای تیک‌خوردهٔ همان استان.
 * این اندپوینت مستقل از سرویس اصلی است تا فیلتر چندشهری هیچ پیچیدگی/بار
 * اضافه‌ای به getProductList نگذارد (خواستهٔ مالک: «جستجوی چندشهری باید
 * به‌اندازهٔ تک‌شهری سریع باشد»).
 */
export class GetCityMarketProductsDto {
  /** شهرهای بازار — الزامی؛ خالی/غایب ⇒ نتیجهٔ خالی (fail-closed:
   *  این سرویس هرگز لیست سراسری نمی‌دهد — صفحهٔ شهر بدون شهر معنا ندارد) */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @Type(() => Number)
  @IsInt({ each: true })
  cityIds!: number[];

  /** slug یا نام دسته (مثل «پسته») — با تمام فرزندانش فیلتر می‌شود */
  @IsOptional()
  @IsString()
  categorySlug?: string;

  /** عبارت جستجو (نام محصول + نام دسته — عین لیست ملی) */
  @IsOptional()
  @IsString()
  s?: string;

  /** مرتب‌سازی — عین لیست ملی: مرتبط‌ترین (نردبان ← ویژه ← آپدیت) / جدیدترین */
  @IsOptional()
  @IsString()
  sort?: 'related' | 'newest';

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
  pageSize?: number;
}
