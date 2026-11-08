import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const SUPPORT_MESSAGE_KINDS = ['text', 'image', 'video', 'file'] as const;
export type SupportMessageKind = (typeof SUPPORT_MESSAGE_KINDS)[number];

/** گفتگوی پشتیبانی (سمت کاربر) — DTO ها */
export class SendMessageDto {
  /** نوع پیام — پیش‌فرض متن (خواسته مالک ۸-۱۱: پیوست در پشتیبانی) */
  @IsOptional()
  @IsIn(SUPPORT_MESSAGE_KINDS)
  kind?: SupportMessageKind;

  /** متن یا کپشن — با پیوست می‌تواند خالی باشد؛ بدون پیوست حداقل ۵ نویسه */
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  text?: string;

  /** URL عمومی فایل — از /support/uploadFile آمده */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  fileUrl?: string;

  /** کلید ذخیره‌سازی — مالکیت با الگوی support/<userId>/… چک می‌شود */
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
