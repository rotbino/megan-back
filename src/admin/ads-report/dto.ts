import { IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PRODUCT_STATUSES, type ProductStatusKey } from '../admin-products/dto';

/**
 * گزارش آگهی‌ها بر پایهٔ تاکسونومی v2 (گروه‌بندی جدید ایمچ).
 *
 * nodeKey:
 *  • خالی/'all'   → همهٔ آگهی‌ها (نمای کلی)
 *  • 'unmapped'   → آگهی‌هایی که دستهٔ باسکولشان هنوز به v2 نگاشت نشده
 *  • کلید v2      → مثل 'agri.pulses.chickpea' (خودش + کل زیردرخت)
 *
 * attrs: فیلتر ویژگی‌های پایلوت — { attrKey: [label, …] } — تطبیق با
 * توکن‌های نام آزاد آگهی (نرمال‌ساز فارسی + ارقام).
 */
export class GetAdsReportDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  nodeKey?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  provinceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cityId?: number;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES as unknown as string[])
  status?: ProductStatusKey;

  @IsOptional()
  @IsString()
  @Length(2, 60)
  search?: string;

  /** فقط کلید/برچسب‌های تعریف‌شده در تاکسونومی قبول می‌شود (سرویس پاک‌سازی می‌کند) */
  @IsOptional()
  @IsObject()
  attrs?: Record<string, string[]>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  perPage?: number;
}
