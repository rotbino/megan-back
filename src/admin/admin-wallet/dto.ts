import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** فاز A5 — DTO های مدیریت شارژها (admin/wallet/*) — جایگزین مسیر قدیمی wallet/* */

/** POST /admin/wallet/getChargeOrders — صف بررسی فیش‌های شارژ */
export class GetAdminChargeOrdersDto {
  /** فقط سفارش‌های با این وضعیت */
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: string;

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

/** POST /admin/wallet/reviewChargeOrder — تأیید (شارژ اعمال می‌شود) یا رد با دلیل */
export class ReviewAdminChargeOrderDto {
  @IsString()
  @IsNotEmpty({ message: 'شناسه سفارش الزامی است.' })
  orderId!: string;

  /** true = تأیید، false = رد */
  @IsBoolean()
  approve!: boolean;

  /** دلیل رد — در رد اجباری است */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}
