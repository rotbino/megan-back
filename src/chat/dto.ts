import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

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

/** POST /chat/sendMessage */
export class SendMessageDto {
  @IsString()
  threadId!: string;

  @IsString()
  @Length(1, 2000)
  text!: string;
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

/** فیلد اختیاری توضیحی برای سازگاری آینده */
export class ChatNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
