import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/** انواع فعالیت — توسعه‌پذیر: نوع جدید = مقدار جدید همین enum */
export const ACTIVITY_TYPES = ['search', 'category_view', 'page_view'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export class LogActivityDto {
  @IsIn(ACTIVITY_TYPES)
  type!: ActivityType;

  /** متن جستجو (type=search) */
  @IsOptional()
  @IsString()
  @Length(1, 80)
  q?: string;

  /** نام/اسلاگ دسته انتخاب‌شده (type=category_view) */
  @IsOptional()
  @IsString()
  @Length(1, 80)
  categoryName?: string;

  /** مسیر صفحه (type=page_view) */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  path?: string;

  /** نشست مرورگر مهمان — uuid سمت کلاینت */
  @IsOptional()
  @IsString()
  @Length(8, 40)
  sessionId?: string;
}

export class AdminListActivitiesDto {
  /** فیلتر نوع — خالی = همه */
  @IsOptional()
  @IsIn(ACTIVITY_TYPES)
  type?: ActivityType;

  /** جستجو در متن جستجو/دسته/مسیر */
  @IsOptional()
  @IsString()
  @Length(1, 80)
  q?: string;

  /** فقط فعالیت‌های یک کاربر */
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number;
}
