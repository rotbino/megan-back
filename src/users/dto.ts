import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class GetUserByPhoneDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل باید ۱۱ رقم و با 09 شروع شود.' })
  phone!: string;
}

/** پروفایل کسب‌وکار embedded — فیلدهای myuser_profiles باسکول */
export class BusinessProfileDto {
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(200) activity_domain?: string;
  @IsOptional() @IsInt() @Min(0) human_resource_count?: number;
  @IsOptional() @IsString() @MaxLength(500) profile_photo?: string;
  @IsOptional() @IsString() @MaxLength(20) public_phone?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(10) postal_code?: string;
  @IsOptional() @IsString() @MaxLength(26) shaba_code?: string;
  @IsOptional() @IsBoolean() is_company?: boolean;
  @IsOptional() @IsString() @MaxLength(100) company_name?: string;
  @IsOptional() @IsString() @MaxLength(50) company_register_code?: string;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(50) first_name?: string;
  @IsOptional() @IsString() @MaxLength(50) last_name?: string;
  @IsOptional() @IsIn(['آقا', 'خانم'], { message: 'جنسیت باید «آقا» یا «خانم» باشد.' }) sex?: string;
  @IsOptional() @IsBoolean() is_buyer?: boolean;
  @IsOptional() @IsBoolean() is_seller?: boolean;
  @IsOptional() @IsString() @MaxLength(300) business_desc?: string;
  @IsOptional() @IsUrl({}, { message: 'آدرس تصویر معتبر نیست.' }) avatar_url?: string;
  @IsOptional() @Type(() => BusinessProfileDto) profile?: BusinessProfileDto;
}
