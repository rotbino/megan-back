import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** POST /admin/backup/transfer — شروع انتقال کامل یک دیتابیس به مونگوی لوکال */
export class BackupTransferDto {
  /** نام دیتابیس روی سرور ابری (Atlas) */
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, { message: 'نام دیتابیس معتبر نیست.' })
  database!: string;

  /** حذف کالکشن‌های هم‌نام مقصد پیش از کپی (پیش‌فرض true — کپی دقیق) */
  @IsOptional()
  @IsBoolean()
  dropTarget?: boolean;

  /**
   * نام دیتابیس مقصد — پیش‌فرض همان نام مبدأ. کاربرد پیشرفته (آزمون/آینه)
   * و در UI افشا نمی‌شود؛ گارد سرویس مانع انتقال یک سرور به خودش می‌شود.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, { message: 'نام دیتابیس مقصد معتبر نیست.' })
  targetDatabase?: string;
}

/** POST /admin/backup/getJob — وضعیت لحظه‌ای جاب انتقال */
export class BackupJobDto {
  @IsString()
  @MaxLength(64)
  jobId!: string;
}
