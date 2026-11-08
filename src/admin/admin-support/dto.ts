import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const SUPPORT_KINDS = ['text', 'image', 'video', 'file'] as const;

const OID_MSG = 'شناسه کاربر معتبر نیست.';

/** چت‌های پشتیبانی (ادمین) — DTO ها */
export class GetSupportThreadListDto {
  /** جستجوی آزاد — نام/موبایل/username کاربر */
  @IsOptional()
  @IsString()
  @Length(2, 60)
  search?: string;

  /** همه / فقط خوانده‌نشده / فقط در انتظار پاسخ پشتیبان */
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

export class UserIdDto {
  @IsString()
  @IsNotEmpty({ message: OID_MSG })
  userId!: string;
}

export class SendSupportReplyDto {
  @IsString()
  @IsNotEmpty({ message: OID_MSG })
  userId!: string;

  /** نوع پیام — پیش‌فرض متن (خواسته مالک ۸-۱۱: پیوست در پشتیبانی) */
  @IsOptional()
  @IsIn(SUPPORT_KINDS)
  kind?: 'text' | 'image' | 'video' | 'file';

  /** متن یا کپشن — با پیوست می‌تواند خالی باشد */
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  text?: string;

  /** URL عمومی فایل — از /admin/support/uploadFile آمده */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  fileUrl?: string;

  /** کلید ذخیره‌سازی — مالکیت با الگوی support-admin/<adminId>/… چک می‌شود */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  fileKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(190)
  fileName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5 * 1024 * 1024)
  fileSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fileMime?: string;
}
