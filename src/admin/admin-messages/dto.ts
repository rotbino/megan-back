import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/** پیام مستقیم ادمین → کاربر (مکالمه سنجاق‌شده «پشتیبانی ایمچ» سمت کاربر) */

const OID_MSG = 'شناسه کاربر معتبر نیست.';

export class SendToUserDto {
  @IsString()
  @IsNotEmpty({ message: OID_MSG })
  userId!: string;

  @IsString()
  @Length(3, 2000, { message: 'متن پیام باید بین ۳ تا ۲۰۰۰ نویسه باشد.' })
  text!: string;
}

/** POST /admin/messages/sendToUsers — ارسال به چند کاربر انتخابی */
export class SendToUsersDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'حداقل یک کاربر انتخاب کنید.' })
  @ArrayMaxSize(500, { message: 'حداکثر ۵۰۰ کاربر در هر ارسال گروهی.' })
  @IsString({ each: true })
  userIds!: string[];

  @IsString()
  @Length(3, 2000, { message: 'متن پیام باید بین ۳ تا ۲۰۰۰ نویسه باشد.' })
  text!: string;
}

/** POST /admin/messages/sendToAll — ارسال به همه (با مخاطب اختیاری) */
export class SendToAllDto {
  /** مخاطب — همه / فقط فعال‌ها / فروشندگان / خریداران / احرازشده‌ها */
  @IsOptional()
  @IsIn(['all', 'active', 'sellers', 'buyers', 'verified'])
  audience?: string;

  @IsString()
  @Length(3, 2000, { message: 'متن پیام باید بین ۳ تا ۲۰۰۰ نویسه باشد.' })
  text!: string;
}

/** POST /admin/messages/getUserMessages — تاریخچه پیام‌های یک کاربر */
export class GetUserMessagesDto {
  @IsString()
  @IsNotEmpty({ message: OID_MSG })
  userId!: string;

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
