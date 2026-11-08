import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { FEEDBACK_CATEGORIES } from '../../survey/dto';

export class GetSurveyListDto {
  @ApiPropertyOptional({ description: 'جستجو: نام/نام خانوادگی/موبایل/یوزرنیم' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;

  @ApiPropertyOptional({ enum: FEEDBACK_CATEGORIES, description: 'فیلتر دسته بازخورد' })
  @IsOptional()
  @IsIn(FEEDBACK_CATEGORIES as unknown as string[])
  category?: string;

  @ApiPropertyOptional({ description: 'صفحه (پیش‌فرض ۱)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'در هر صفحه (پیش‌فرض ۲۰، حداکثر ۵۰)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  perPage?: number;
}

export class DeleteSurveyDto {
  @ApiPropertyOptional({ description: 'شناسه بازخورد (FeedbackItem.id)' })
  @IsString()
  @MaxLength(40)
  id: string;
}
