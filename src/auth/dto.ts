import { IsString, Length, Matches } from 'class-validator';

export class SendOtpDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل معتبر نیست.' })
  phone!: string;
}

export class VerifyOtpDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل معتبر نیست.' })
  phone!: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'کد تایید ۴ رقمی است.' })
  code!: string;
}

export class RefreshTokenDto {
  @IsString()
  @Length(20, 512)
  refreshToken!: string;
}
