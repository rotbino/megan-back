import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class SendOtpDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل معتبر نیست.' })
  phone!: string;
}

export class LoginDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل معتبر نیست.' })
  phone!: string;

  /** فقط وقتی کاربر رمز تعیین کرده باشد الزامی است — وگرنه حذف می‌شود */
  @IsOptional()
  @IsString()
  @Length(1, 72)
  password?: string;
}

export class SetPasswordDto {
  @IsString()
  @Length(6, 72, { message: 'رمز عبور باید بین ۶ تا ۷۲ نویسه باشد.' })
  password!: string;

  /** تغییر رمز بعدی — فقط وقتی رمز فعلی وجود دارد الزامی است */
  @IsOptional()
  @IsString()
  currentPassword?: string;
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
