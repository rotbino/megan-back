import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** فاز A5 — DTO های مدیریت ادمین‌ها (admin/admins/*) — فقط SUPER_ADMIN */

/** POST /admin/admins/createAdmin */
export class CreateAdminDto {
  /** نام کاربری ورود — معمولاً شماره موبایل؛ یکتا */
  @IsString()
  @IsNotEmpty({ message: 'نام کاربری الزامی است.' })
  @Length(4, 40)
  username!: string;

  @IsString()
  @IsNotEmpty({ message: 'نام نمایشی الزامی است.' })
  @MaxLength(60)
  name!: string;

  @IsIn(['ADMIN', 'SUPER_ADMIN'], { message: 'نقش باید ADMIN یا SUPER_ADMIN باشد.' })
  role!: string;

  @IsString()
  @IsNotEmpty({ message: 'رمز عبور الزامی است.' })
  @Length(8, 64, { message: 'رمز عبور باید بین ۸ تا ۶۴ نویسه باشد.' })
  password!: string;
}

/** POST /admin/admins/setAdminActive */
export class SetAdminActiveDto {
  @IsMongoId({ message: 'شناسه ادمین معتبر نیست.' })
  adminId!: string;

  @IsBoolean()
  active!: boolean;
}

/** POST /admin/admins/resetAdminPassword */
export class ResetAdminPasswordDto {
  @IsMongoId({ message: 'شناسه ادمین معتبر نیست.' })
  adminId!: string;

  @IsString()
  @IsNotEmpty({ message: 'رمز عبور جدید الزامی است.' })
  @Length(8, 64, { message: 'رمز عبور باید بین ۸ تا ۶۴ نویسه باشد.' })
  newPassword!: string;
}

/** POST /admin/admins/getAdminList */
export class GetAdminListDto {
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
