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

  @IsString()
  @Length(1, 2000, { message: 'متن پاسخ باید بین ۱ تا ۲۰۰۰ نویسه باشد.' })
  text!: string;
}
