import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class GetReviewListDto {
  @ApiPropertyOptional({ description: 'جستجو: متن نظر / نام نویسنده / نام فروشنده / یوزرنیم' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;

  @ApiPropertyOptional({ description: 'فیلتر امتیاز (۱..۵)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

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

export class DeleteReviewDto {
  @IsString()
  @MaxLength(40)
  id: string;
}
