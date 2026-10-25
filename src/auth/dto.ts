import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class SendOtpDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل باید ۱۱ رقم و با 09 شروع شود.' })
  phone!: string;
}

export class VerifyOtpDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل باید ۱۱ رقم و با 09 شروع شود.' })
  phone!: string;

  @IsString()
  @Matches(/^\d{5}$/, { message: 'کد تایید ۵ رقمی است.' })
  code!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty({ message: 'رفرش‌توکن الزامی است.' })
  refreshToken!: string;
}
