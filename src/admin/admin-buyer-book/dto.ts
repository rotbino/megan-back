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

/** مدیریت دفتر خرید (admin/buyer-book/*) — خواستهٔ مالک ۸-۱۱:
 *  درخواست‌های خرید دوره‌ای هم مثل فوری بازبینی ادمین می‌خواهند. */

export class GetAdminBookListDto {
  /** جستجوی آزاد — نام دسته/مسیر یا موبایل/نام خریدار */
  @IsOptional()
  @IsString()
  @Length(2, 60)
  search?: string;

  /** فیلتر وضعیت — خالی = همه */
  @IsOptional()
  @IsIn(['pending', 'confirmed', 'rejected'])
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

export class BookItemIdDto {
  @IsString()
  @Length(12, 32)
  id!: string;
}

/** تأیید/رد کالای دفتر خرید */
export class ReviewAdminBookItemDto {
  @IsString()
  @Length(12, 32)
  id!: string;

  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}
