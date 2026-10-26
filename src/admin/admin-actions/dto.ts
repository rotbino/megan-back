import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/** فاز A5 — DTO های لاگ عملیات ادمین (admin/actions/*) */

/** POST /admin/actions/getAdminActions — لیست لاگ با فیلتر */
export class GetAdminActionsDto {
  /** فقط عملیات‌های این ادمین */
  @IsOptional()
  @IsMongoId({ message: 'شناسه ادمین معتبر نیست.' })
  adminId?: string;

  /** جستجوی مسیر عملیات — مثل review یا setLadder (contains) */
  @IsOptional()
  @IsString()
  @Length(2, 80)
  action?: string;

  /** فقط این نوع هدف */
  @IsOptional()
  @IsIn(['product', 'user', 'buy_request', 'charge_order', 'base_data', 'admin'])
  targetType?: string;

  /** از این تاریخ به بعد (ISO 8601) */
  @IsOptional()
  @IsString()
  @Length(10, 32)
  dateFrom?: string;

  /** تا این تاریخ (ISO 8601) */
  @IsOptional()
  @IsString()
  @Length(10, 32)
  dateTo?: string;

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
