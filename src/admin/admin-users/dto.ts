import { Type } from 'class-transformer';
import {
  IsBoolean,
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

/** فاز A3 — DTO های مدیریت کاربران (admin/users/*) */

export class GetUserListDto {
  /** جستجوی آزاد — موبایل / نام / نام خانوادگی / userName */
  @IsOptional()
  @IsString()
  @Length(2, 60)
  search?: string;

  @IsOptional()
  @IsIn(['USER', 'ADMIN'])
  role?: string;

  /** وضعیت حساب — true=فعال / false=غیرفعال */
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** فقط احرازشده‌ها / فقط احرازنشده‌ها */
  @IsOptional()
  @IsBoolean()
  verified?: boolean;

  /** فقط فروشنده‌ها */
  @IsOptional()
  @IsBoolean()
  seller?: boolean;

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
  id!: string;
}

export class SetUserActiveDto extends UserIdDto {
  @IsBoolean()
  active!: boolean;
}

export class SetUserRolesDto extends UserIdDto {
  @IsOptional()
  @IsBoolean()
  isBuyer?: boolean;

  @IsOptional()
  @IsBoolean()
  isSeller?: boolean;

  /** نقش سیستم — USER | ADMIN (ادمینِ توکن کاربر؛ پنل مدیریت جدا است) */
  @IsOptional()
  @IsIn(['USER', 'ADMIN'])
  role?: string;
}

export class CreditWalletDto extends UserIdDto {
  /** مثبت = شارژ دستی؛ منفی = کسر (تومان) */
  @Type(() => Number)
  @IsInt()
  @Min(-50_000_000, { message: 'مبلغ اصلاح معتبر نیست.' })
  @Max(50_000_000, { message: 'مبلغ اصلاح معتبر نیست.' })
  amount!: number;

  @IsString()
  @Length(3, 200, { message: 'دلیل اصلاح باید بین ۳ تا ۲۰۰ نویسه باشد.' })
  reason!: string;
}

export class ReviewVerificationAdminDto {
  /** ObjectId درخواست احراز (VerificationOrder) */
  @IsString()
  @IsNotEmpty({ message: 'شناسه درخواست معتبر نیست.' })
  orderId!: string;

  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @Length(3, 300, { message: 'دلیل رد باید بین ۳ تا ۳۰۰ نویسه باشد.' })
  rejectionReason?: string;
}
