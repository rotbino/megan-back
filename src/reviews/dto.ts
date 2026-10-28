import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class GetSellerReviewsDto {
  @ApiProperty({ description: 'شناسه عمومی پروفایل فروشنده (user_name)' })
  @IsString()
  @MaxLength(64)
  userName: string;

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

export class AddSellerReviewDto {
  @ApiProperty({ description: 'شناسه عمومی پروفایل فروشنده (user_name)' })
  @IsString()
  @MaxLength(64)
  userName: string;

  @ApiProperty({ minimum: 1, maximum: 5, description: 'امتیاز ۱ تا ۵ ستاره' })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({ description: 'متن نظر', maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  text: string;
}
