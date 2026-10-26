import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const ID_MSG = 'شناسه آگهی معتبر نیست.';

/** وضعیت‌های آگهی — تب‌های پنل ادمین (عین پنل کاربر) */
export const PRODUCT_STATUSES = ['pending', 'confirmed', 'rejected', 'deleted'] as const;
export type ProductStatusKey = (typeof PRODUCT_STATUSES)[number];

/** فاز A4 — DTO های مدیریت آگهی‌ها (admin/products/*) */

export class GetAdminProductListDto {
  /** جستجوی آزاد — نام محصول / موبایل فروشنده / نام کاربری / نام دسته */
  @IsOptional()
  @IsString()
  @Length(2, 60)
  search?: string;

  /** فیلتر وضعیت — خالی = همه */
  @IsOptional()
  @IsIn(PRODUCT_STATUSES as unknown as string[])
  status?: ProductStatusKey;

  /** دسته (با تمام فرزندان) — id باسکولی مثل 44=پسته */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  provinceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cityId?: number;

  /** ObjectId فروشنده — لینک «آگهی‌های این کاربر» از صفحه کاربر */
  @IsOptional()
  @IsString()
  @Length(12, 32)
  sellerId?: string;

  /** فقط نردبان‌شده‌ها / فقط بدون نردبان */
  @IsOptional()
  @IsBoolean()
  ladder?: boolean;

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

export class ProductIdDto {
  @Type(() => Number)
  @IsInt({ message: ID_MSG })
  id!: number;
}

/** تأیید/رد آگهیِ در انتظار — منطق دامنه (ProductsService.reviewProduct) */
export class ReviewAdminProductDto {
  @Type(() => Number)
  @IsInt({ message: ID_MSG })
  id!: number;

  @IsBoolean()
  approve!: boolean;

  /** دلایل رد — عین جعبه باسکول (آرایه) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  rejectionReasons?: string[];
}

/**
 * تغییر مستقیم وضعیت (اختیار ادمین فراتر از بازبینی):
 *  confirmed → rejected/deleted (برداشتن از عمومی)؛ rejected → confirmed (اصلاح)؛
 *  حذف = نرم + پاک‌سازی فایل‌های گالری.
 */
export class SetProductStatusDto extends ProductIdDto {
  @IsIn(PRODUCT_STATUSES as unknown as string[], { message: 'وضعیت آگهی معتبر نیست.' })
  status!: ProductStatusKey;

  /** هنگام رد الزامی — به فروشنده در پنلش نمایش داده می‌شود */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  rejectionReasons?: string[];
}

/** روشن/خاموش کردن نردبان ادمینی (هدیه/برچیدن) */
export class SetLadderDto extends ProductIdDto {
  @IsBoolean()
  active!: boolean;
}
