import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** چهار دسته بازخورد نظرسنجی — «تحقیقات بازار» به‌جای امتیازدهی۵گانه */
export const FEEDBACK_CATEGORIES = ['bug', 'critique', 'improvement', 'feature'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export class SubmitFeedbackDto {
  @ApiProperty({ enum: FEEDBACK_CATEGORIES, description: 'دسته بازخورد' })
  @IsIn(FEEDBACK_CATEGORIES as unknown as string[], { message: 'دسته بازخورد معتبر نیست.' })
  category: FeedbackCategory;

  @ApiProperty({ description: 'عنوان کوتاه', minLength: 5, maxLength: 120 })
  @IsString()
  @MinLength(5, { message: 'عنوان دست‌کم ۵ نویسه باشد.' })
  @MaxLength(120, { message: 'عنوان حداکثر ۱۲۰ نویسه باشد.' })
  title: string;

  @ApiProperty({ description: 'شرح کامل نیاز/مشکل', minLength: 20, maxLength: 2000 })
  @IsString()
  @MinLength(20, { message: 'شرح دست‌کم ۲۰ نویسه باشد.' })
  @MaxLength(2000, { message: 'شرح حداکثر ۲۰۰۰ نویسه باشد.' })
  body: string;
}

export class UpvoteFeedbackDto {
  @ApiProperty({ description: 'شناسه بازخورد (FeedbackItem.id)' })
  @IsString()
  @MaxLength(40)
  id: string;
}

export class ListFeedbackDto {
  @ApiPropertyOptional({ enum: FEEDBACK_CATEGORIES, description: 'فیلتر دسته' })
  @IsOptional()
  @IsIn(FEEDBACK_CATEGORIES as unknown as string[])
  category?: string;

  @ApiPropertyOptional({ description: 'مرتب‌سازی: recent (جدیدترین) | top (پرموافق‌ترین)' })
  @IsOptional()
  @IsIn(['recent', 'top'])
  sort?: string;

  @ApiPropertyOptional({ description: 'صفحه (پیش‌فرض ۱)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'در هر صفحه (پیش‌فرض ۱۰، حداکثر ۳۰)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  perPage?: number;
}
