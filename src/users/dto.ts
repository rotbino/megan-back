import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  first_name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  last_name?: string;

  /** مکان پیش‌فرض کاربر — id عددی باسکول (null = پاک‌کردن) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  province_id?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  city_id?: number | null;

  /** «آقا» / «خانم» — مثل باسکول */
  @IsOptional()
  @IsString()
  @Matches(/^(آقا|خانم)$/, { message: 'جنسیت باید «آقا» یا «خانم» باشد.' })
  sex?: string;

  @IsOptional()
  @IsBoolean()
  is_buyer?: boolean;

  @IsOptional()
  @IsBoolean()
  is_seller?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  business_desc?: string;

  /** URL عمومی حاصل از uploads/uploadImage */
  @IsOptional()
  @IsString()
  @Length(10, 500)
  avatar_url?: string;

  /** پروفایل کسب‌وکار embedded — با مقادیر موجود merge می‌شود */
  @IsOptional()
  profile?: Record<string, unknown>;
}

export class GetUserByPhoneDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل معتبر نیست.' })
  phone!: string;
}
