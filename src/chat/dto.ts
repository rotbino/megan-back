import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

/**
 * POST /chat/startThread — شروع/یافتن مکالمه.
 * دو مسیر: productId (گفتگو روی آگهی) یا userName (گفتگوی مستقیم از پروفایل
 * فروشنده — عین «ارسال پیام» باسکول؛ بدون آگهی زمینه).
 */
export class StartThreadDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productId?: number;

  /** شناسه عمومی پروفایل فروشنده — وقتی productId نیامده الزامی است */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userName?: string;
}

/** نوع پیام — متن یا پیوست (خواسته مالک ۷-۱۱) */
export const MESSAGE_KINDS = ['text', 'image', 'video', 'file'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** POST /chat/sendMessage — متن یا فایل (تصویر/ویدئو/فایل تا ۵MB) + متن دلخواه */
export class SendMessageDto {
  @IsString()
  threadId!: string;

  /** نوع پیام — پیش‌فرض متن */
  @IsOptional()
  @IsIn(MESSAGE_KINDS)
  kind?: MessageKind;

  /** متن پیام — برای پیام فایل‌دار می‌تواند خالی (کپشن) باشد */
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  text?: string;

  /** URL عمومی فایل — از /chat/uploadFile آمده */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  fileUrl?: string;

  /** کلید ذخیره‌سازی — مالکیت فایل با الگوی chat/<userId>/… چک می‌شود */
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

/** POST /chat/getThreadMessages — پیام‌های مکالمه (جدید → قدیمی با before) */
export class GetThreadMessagesDto {
  @IsString()
  threadId!: string;

  /** صفحه‌بندی مکان‌نما — createdAt آخرین پیام صفحه قبل */
  @IsOptional()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take?: number;
}

/** POST /chat/getThread */
export class GetThreadDto {
  @IsString()
  threadId!: string;
}

/** POST /chat/markThreadRead — خواندن بدون گرفتن پیام‌ها (تماس تلفنی جلوی صفحه) */
export class MarkThreadReadDto {
  @IsString()
  threadId!: string;
}

/**
 * POST /chat/editMessage — ویرایش متن/کپشن پیام خودی.
 * فقط تا وقتی طرف مقابل ندیده است (readAt=null) — بعد از آن پیام «مدرک» است.
 */
export class EditMessageDto {
  @IsString()
  messageId!: string;

  @IsString()
  @Length(0, 2000)
  text!: string;
}

/** POST /chat/deleteMessage — حذف پیام خودی دیده‌نشده (+ پاک‌کردن فایل از سرور) */
export class DeleteMessageDto {
  @IsString()
  messageId!: string;
}
