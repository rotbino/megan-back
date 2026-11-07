import { IsString, Length } from 'class-validator';

/** گفتگوی پشتیبانی (سمت کاربر) — DTO ها */
export class SendMessageDto {
  /** متن پیام به پشتیبان — حداقل ۵ نویسه (همان ولیدیشن فرم قبلی) */
  @IsString()
  @Length(5, 2000, { message: 'متن پیام باید بین ۵ تا ۲۰۰۰ نویسه باشد.' })
  text!: string;
}
