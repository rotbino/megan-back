import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

/** POST /chat/startThread — شروع/یافتن مکالمه روی یک آگهی */
export class StartThreadDto {
  @Type(() => Number)
  @IsInt()
  productId!: number;
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
