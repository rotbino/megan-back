import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

const OID_MSG = 'شناسه مکالمه معتبر نیست.';

/**
 * چت‌های کاربران (ادمین) — DTO ها.
 *
 * نکته مهم محصول: ادمین فقط «تماشاگر» است — هیچ اندپوینتی در این ماژیل
 * وضعیت خواندن پیام‌ها (readAt) را تغییر نمی‌دهد؛ خوانده‌شدن فقط وقتی
 * رخ می‌دهد که خود کاربر گیرنده مکالمه را باز کند.
 */
export class GetThreadListDto {
  /** جستجوی آزاد — نام/موبایل/username طرف‌ها یا نام محصول */
  @IsOptional()
  @IsString()
  @Length(2, 60)
  search?: string;

  /** همه / فقط خوانده‌نشده / فقط در انتظار پاسخ فروشنده */
  @IsOptional()
  @IsIn(['all', 'unread', 'awaiting'])
  filter?: 'all' | 'unread' | 'awaiting';

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

export class ThreadIdDto {
  @IsString()
  @IsNotEmpty({ message: OID_MSG })
  threadId!: string;
}
