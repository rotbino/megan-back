import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** فاز A5 — DTO های نگهداشت فایل ادمین (admin/uploads/*) */

/** POST /admin/uploads/deleteOrphans */
export class DeleteOrphansAdminDto {
  /** شناسه‌های مشخص — خالی = همه
   *  (آرایه خالی هم «همه» است — عمداً برای پاک‌سازی کامل) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];
}

/** POST /admin/uploads/getUsage */
export class UsageAdminDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
