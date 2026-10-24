/**
 * صفحه‌بندی مبتنی بر cursor — رفع ضعف باسکول که کل لیست درخواست‌های خرید را
 * یک‌جا (۲.۶MB بدون صفحه‌بندی!) برمی‌گرداند. این الگو برای هر لیست پروژه استفاده می‌شود.
 */
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CursorPagerDto {
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take = 20;

  @ApiPropertyOptional({ description: 'شناسه آخرین رکورد صفحه قبل (cursor)' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'برای صفحه بعدی: ?cursor=... — برای قبلی: ?cursor=...&back=true' })
  @IsOptional()
  @Type(() => Boolean)
  back = false;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  prevCursor: string | null;
}
