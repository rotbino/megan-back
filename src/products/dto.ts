import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** ویژگی مرحله «جزئیات نهایی» ویزارد */
export class ProductFeatureDto {
  @IsString()
  @Length(1, 50)
  key!: string;

  @IsString()
  @Length(1, 200)
  value!: string;
}

/** ورودی getProductList — منطبق ProductQuery فرانت */
export class GetProductListDto {
  /** slug یا نام دسته (مثل «پسته») — با تمام فرزندانش فیلتر می‌شود */
  @IsOptional()
  @IsString()
  categorySlug?: string;

  /** عبارت جستجو (مثل باسکول: ?s=) */
  @IsOptional()
  @IsString()
  s?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  provinceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cityId?: number;

  /** مرتب‌سازی — دقیقاً مثل باسکول: مرتبط‌ترین (نردبان اول) / جدیدترین؛
   *  match = «مطابق نیاز من» (خواستهٔ مالک ۱۱-۱۱): نوع ← حجم/موجودی ←
   *  نزدیکی به شهر خریدار + بوست نردبان/ویژه — فقط با پارامترهای match* معنا دارد */
  @IsOptional()
  @IsString()
  sort?: 'related' | 'newest' | 'match';

  /** زمینهٔ تطابق (sort=match) — نوع کالای درخواستی خریدار (مثل «آگریا») */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  matchType?: string;

  /** میزان نیازمندی خریدار — مبنای امتیاز حجم/موجودی */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  matchAmount?: number;

  /** واحد نیازمندی — مثل «کیلوگرم» (تبدیل خانوادهٔ وزنی/عددی) */
  @IsOptional()
  @IsString()
  @Length(1, 20)
  matchUnit?: string;

  /** مکان خریدار (استان/شهر) — امتیاز نزدیکی؛ فیلتر نیست */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  nearProvinceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  nearCityId?: number;

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

export class GetProductByIdDto {
  @Type(() => Number)
  @IsInt()
  id!: number;
}

/** ورودی reportView — ping آمار بازدید مرورگر (مهمان با sessionId) */
export class ReportViewDto {
  @Type(() => Number)
  @IsInt()
  id!: number;

  /** نشست مرورگر مهمان — uuid سمت کلاینت */
  @IsOptional()
  @IsString()
  @Length(8, 40)
  sessionId?: string;
}

/**
 * ورودی getSellerPhone — دو مسیر: آگهی (id) یا پروفایل (userName).
 * حداقل یکی باید بیاید (ولیدیشن در سرویس — پیام خطای گویا).
 */
export class GetSellerPhoneDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userName?: string;
}

/** ورودی createProduct — دقیقاً خروجی ویزارد ۶ مرحله‌ای فرانت */
export class CreateProductDto {
  @IsString()
  @Length(2, 150)
  productName!: string;

  /** دسته برگ انتخابی (مثل پسته=44) */
  @Type(() => Number)
  @IsInt()
  subCategoryId!: number;

  @Type(() => Number)
  @IsInt()
  provinceId!: number;

  @Type(() => Number)
  @IsInt()
  cityId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSaleAmount!: number;

  /** کف قیمت هر واحد (تومان) — 0 یعنی «تماس بگیرید» */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSalePrice!: number;

  /** اعتبار قیمت به روز — ۱ تا ۵ روز + گزینهٔ «سایر» با عدد بزرگ‌تر؛
   *  پیش‌فرض ۳ روز (خواسته مالک ۷-۱۱ دور هفدهم) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  priceValidityDays?: number;

  @IsString()
  @Length(30, 4000)
  description!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductFeatureDto)
  features?: ProductFeatureDto[];

  /** URLهای عمومی حاصل از uploadImage (حداکثر ۴ عکس مثل باسکول) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];
}

export class GetRelatedProductsDto {
  @Type(() => Number)
  @IsInt()
  subCategoryId!: number;

  @Type(() => Number)
  @IsInt()
  excludeId!: number;

  /** دستهٔ پدر — برای گسترش نتایج وقتی زیردسته کم‌آیتم است (مشابه‌ها) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  /** صفحه‌بندی مشابه‌ها (خواسته مالک ۱-۱۱ دور هفتم) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  pageSize?: number;
}

/** آگهی‌های دیگر همان فروشنده — ریل افقی صفحهٔ محصول (خواسته مالک ۱-۱۱ دور هفتم) */
export class GetSellerProductsDto {
  /** userName عمومی فروشنده */
  @IsString()
  @Length(2, 60)
  userName!: string;

  /** آگهی صفحهٔ فعلی — از نتایج حذف می‌شود */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  excludeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  limit?: number;
}

/** فروشنده عمومی + آگهی‌های تاییدشده (صفحه پروفایل کسب‌وکار) */
export class GetSellerDto {
  @IsString()
  @Length(2, 60)
  userName!: string;
}

export class DeleteMyProductDto {
  @Type(() => Number)
  @IsInt()
  id!: number;
}

/** POST /products/getMyProductDetail — پیش‌پر کردن فرم ویرایش آگهی خودم */
export class GetMyProductDetailDto {
  @Type(() => Number)
  @IsInt()
  id!: number;
}

/** POST /products/getMyProductStats — آمار آگهی خودم با بازهٔ دلخواه (خواسته مالک ۳-۱۱) */
export class GetMyProductStatsDto {
  @Type(() => Number)
  @IsInt()
  id!: number;

  /** بازهٔ آمار به روز — پیش‌فرض ۱۴؛ ۰ = کل دورهٔ زندگی آگهی (از ثبت) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  days?: number;
}

/** POST /products/updateMyProduct — ویرایش آگهی خودم (بدون تایید مجدد — خواسته مالک ۴-۱۱) */
export class UpdateMyProductDto extends CreateProductDto {
  @Type(() => Number)
  @IsInt()
  id!: number;
}

/** ردیف تغییر گروهی — قیمت + موجودی + حداقل سفارش یک آگهی خودم */
export class BulkPriceItemDto {
  @Type(() => Number)
  @IsInt()
  id!: number;

  /** کف قیمت هر واحد (تومان) — 0 یعنی «تماس بگیرید» */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSalePrice!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock!: number;

  /** حداقل سفارش (خواسته مالک ۴-۱۱) — هم‌شکل فرم ویرایش تکی */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSaleAmount!: number;

  /** اعتبار قیمت — اختیاری؛ فقط وقتی فرستاده شود تغییر می‌کند (۷-۱۱ دور هفدهم:
   *  «اگر در ویرایش کالا وارد نکرده بود از همین‌جا بگیرد») */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  priceValidityDays?: number;
}

/** POST /products/updateMyPrice — آپدیت سریع قیمت از کارت آگهی (۷-۱۱ دور هفدهم):
 *  مدال کوچک قیمت + اعتبار؛ مهر زمانی قیمت تازه می‌شود و انقضا صفر می‌شود */
export class UpdateMyPriceDto {
  @Type(() => Number)
  @IsInt()
  id!: number;

  /** کف قیمت هر واحد (تومان) — 0 یعنی «تماس بگیرید» */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSalePrice!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  priceValidityDays?: number;
}

/** POST /products/bulkUpdatePrices — تغییر گروهی قیمت/موجودی (خواسته مالک ۴-۱۱) */
export class BulkUpdatePricesDto {
  @IsArray()
  @ArrayMaxSize(200, { message: 'هر ارسال گروهی حداکثر ۲۰۰ آگهی دارد.' })
  @ValidateNested({ each: true })
  @Type(() => BulkPriceItemDto)
  items!: BulkPriceItemDto[];
}

export class SearchSuggestionsDto {
  @IsString()
  @Length(1, 60)
  typedText!: string;
}

/** POST /products/reviewProduct (ادمین) — تأیید/رد آگهی در انتظار */
export class ReviewProductDto {
  @Type(() => Number)
  @IsInt()
  id!: number;

  @IsBoolean()
  approve!: boolean;

  /** دلایل رد — عین جعبه باسکول (آرایه) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  rejectionReasons?: string[];
}
