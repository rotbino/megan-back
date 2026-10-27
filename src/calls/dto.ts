import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

const OID_MSG = 'شناسه کاربر معتبر نیست.';

export class ReportCallDto {
  /** گیرنده تماس — صاحب شماره‌ای که آشکار شد */
  @IsString()
  @IsNotEmpty({ message: OID_MSG })
  calleeId!: string;

  /** آگهی زمینه‌ی آشکارسازی شماره — اختیاری */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId?: number;

  /** از کجا شماره دیده شد — صفحه آگهی / پروفایل / چت */
  @IsOptional()
  @IsIn(['product', 'profile', 'chat'])
  source?: 'product' | 'profile' | 'chat';
}
