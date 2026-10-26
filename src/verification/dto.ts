import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** POST /verification/getVerificationOrders (ادمین) */
export class GetVerificationOrdersDto {
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

/** POST /verification/reviewVerification (ادمین) */
export class ReviewVerificationDto {
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
