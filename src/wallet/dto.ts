import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** POST /wallet/ladderProduct — خرید نردبان برای آگهی خودِ کاربر
 *  months: ۱ تا ۴ (پیش‌فرض ۱ — خواسته مالک ۳۱-۱۰) */
export class LadderProductDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  months?: number;
}

/** POST /wallet/getChargeOrders (ادمین) */
export class GetChargeOrdersDto {
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

/** POST /wallet/reviewChargeOrder (ادمین) — تأیید → شارژ کیف پول، رد → دلیل */
export class ReviewChargeOrderDto {
  @IsString()
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
