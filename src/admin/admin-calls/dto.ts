import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class GetCallReportDto {
  /** جستجوی آزاد — نام/موبایل/username تماس‌گیرنده یا دریافت‌کننده */
  @IsOptional()
  @IsString()
  @Length(2, 60)
  search?: string;

  /** همه / امروز / ۷ روز / ۳۰ روز */
  @IsOptional()
  @IsIn(['all', 'today', 'd7', 'd30'])
  range?: 'all' | 'today' | 'd7' | 'd30';

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
