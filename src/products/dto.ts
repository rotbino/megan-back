import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
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

  /** مرتب‌سازی — دقیقاً مثل باسکول: مرتبط‌ترین (نردبان اول) / جدیدترین */
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

export class GetProductByIdDto {
  @Type(() => Number)
  @IsInt()
  id!: number;
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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
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

/** POST /products/updateMyProduct — ویرایش آگهی خودم → بازگشت به «در انتظار تایید» */
export class UpdateMyProductDto extends CreateProductDto {
  @Type(() => Number)
  @IsInt()
  id!: number;
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
