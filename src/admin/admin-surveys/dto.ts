import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { SURVEY_SCORES } from '../../survey/dto';

export class GetSurveyListDto {
  @ApiPropertyOptional({ description: 'جستجو: نام/نام خانوادگی/موبایل/یوزرنیم' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;

  @ApiPropertyOptional({ enum: SURVEY_SCORES, description: 'فیلتر امتیاز' })
  @IsOptional()
  @IsIn(SURVEY_SCORES as unknown as string[])
  score?: string;

  @ApiPropertyOptional({ description: 'فقط پاسخ‌های یادداشت‌دار' })
  @IsOptional()
  @IsString()
  withNote?: string; // 'true' | 'false'

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
  @ApiPropertyOptional({ description: 'شناسه پاسخ (SurveyResponse.id)' })
  @IsString()
  @MaxLength(40)
  id: string;
}
