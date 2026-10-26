import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';

/** POST /buy-requests/createBuyRequest — خروجی ویزارد ۵ مرحله‌ای فرانت */
export class CreateBuyRequestDto {
  /** دسته برگ (مثل قیسی زیر میوه خشک) */
  @Type(() => Number)
  @IsInt()
  subCategoryId!: number;

  /** «نوع کالا» — آزاد مثل: پاجوش پیارم (اختیاری، مثل باسکول) */
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  requirementAmount!: number;

  /** هدف درخواست — عین فرم باسکول */
  @IsOptional()
  @IsIn(['price_and_buy', 'price_only'])
  goal?: 'price_and_buy' | 'price_only';

  /** سابقه خرید عمده این کالا */
  @IsOptional()
  @IsBoolean()
  hasHistory?: boolean;

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
  @MaxLength(2000)
  description?: string;
}

/** POST /buy-requests/getBuyRequestList — لیست عمومی (صفحه buyAd-requests) */
export class GetBuyRequestListDto {
  /** جستجو در نوع کالا + نام دسته (مثل باسکول) */
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
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  perPage?: number;
}

/** POST /buy-requests/getBuyRequestContact — آشکارسازی شماره خریدار (لاگین لازم) */
export class GetBuyRequestContactDto {
  @Type(() => Number)
  @IsInt()
  id!: number;
}

/** POST /buy-requests/getMyBuyRequests — تب‌های «درخواستهای من» */
export class GetMyBuyRequestsDto {
  @IsOptional()
  @IsIn(['confirmed', 'pending', 'rejected'])
  status?: string;
}

/** POST /buy-requests/reviewBuyRequest (ادمین) */
export class ReviewBuyRequestDto {
  @Type(() => Number)
  @IsInt()
  id!: number;

  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

/** POST /buy-requests/deleteMyBuyRequest — حذف نرم درخواست خودم */
export class DeleteMyBuyRequestDto {
  @Type(() => Number)
  @IsInt()
  id!: number;
}

/** شماره موبایل برای نشان‌کردن خریدار از لیست عمومی */
export const PHONE_RE = /^09\d{9}$/;
export class PhoneDto {
  @IsString()
  @Matches(PHONE_RE, { message: 'شماره موبایل معتبر نیست.' })
  phone!: string;
}
