import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class AdminLoginDto {
  /** نام کاربری ادمین — می‌تواند شماره موبایل یا هر نامی باشد */
  @IsString()
  @Length(3, 64, { message: 'نام کاربری معتبر نیست.' })
  username!: string;

  @IsString()
  @Length(1, 72)
  password!: string;
}

export class AdminChangePasswordDto {
  @IsString()
  @Length(6, 72, { message: 'رمز عبور جدید باید بین ۶ تا ۷۲ نویسه باشد.' })
  newPassword!: string;

  @IsString()
  @Length(1, 72)
  currentPassword!: string;
}

/** فقط برای sanitize — رمز/هش هرگز در پاسخ‌های ادمین برنمی‌گردد */
export class AdminPublicDto {
  id!: string;
  username!: string;
  name!: string;
  role!: string;
  lastLoginAt!: Date | null;
}
