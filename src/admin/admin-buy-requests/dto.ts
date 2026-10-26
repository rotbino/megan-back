import { Type } from 'class-transformer';
import {
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

const ID_MSG = 'شناسه درخواست خرید معتبر نیست.';

/** فاز A4 — DTO های مدیریت درخواست‌های خرید (admin/buy-requests/*) */

export class GetAdminBuyRequestListDto {
  /** جستجوی آزاد — نوع محصول / موبایل خریدار / نام کاربری / نام دسته */
  @IsOptional()
  @IsString()
  @Length(2, 60)
  search?: string;

  /** فیلتر وضعیت — خالی = همه */
  @IsOptional()
  @IsIn(['pending', 'confirmed', 'rejected', 'deleted'])
  status?: string;

  /** دسته (با تمام فرزندان) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  provinceId?: number;

  /** ObjectId خریدار — لینک از صفحه کاربر */
  @IsOptional()
  @IsString()
  @Length(12, 32)
  userId?: string;

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

export class BuyRequestIdDto {
  @Type(() => Number)
  @IsInt({ message: ID_MSG })
  id!: number;
}

/** تأیید/رد درخواست در انتظار — منطق دامنه (BuyRequestsService.reviewBuyRequest) */
export class ReviewAdminBuyRequestDto {
  @Type(() => Number)
  @IsInt({ message: ID_MSG })
  id!: number;

  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}
