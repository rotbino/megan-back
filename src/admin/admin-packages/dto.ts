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

/** DTO های مدیریت بسته‌های اشتراک (admin/packages/*) — عین الگوی A5 شارژها */

/** POST /admin/packages/getPackageOrders — صف بررسی فیش‌های بسته */
export class GetAdminPackageOrdersDto {
  /** فقط سفارش‌های با این وضعیت */
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: 'pending' | 'approved' | 'rejected';

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

/** POST /admin/packages/reviewPackageOrder — تأیید (بسته فعال/تمدید) یا رد با دلیل */
export class ReviewAdminPackageOrderDto {
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
