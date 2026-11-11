import { IsIn, IsString, Length } from 'class-validator';

/**
 * DTOهای «ثبت‌نام سرویس‌های تخصصی ارزش‌افزوده» (خواستهٔ مالک ۱۱-۱۲).
 *
 * فروشنده‌ها از صفحهٔ عمومی /services در سرویس‌های ریتو و همخرید ثبت‌نام
 * می‌کنند (صنف + نام کسب‌وکار). ثبت‌نام ابراز علاقه‌مندی است — فاز راه‌اندازی
 * هر سرویس فیلدهای تخصصی خودش را اضافه می‌کند.
 */

/** سرویس‌های دارای فرم ثبت‌نام — «فرصت‌های خرید ویژه» هنوز فرم ندارد */
export const SERVICE_IDS = ['ritu', 'hamkharid'] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

/** POST /service-signups/save — ثبت/اصلاح ثبت‌نام در یک سرویس (upsert) */
export class SaveServiceSignupDto {
  @IsIn(SERVICE_IDS as unknown as string[])
  serviceId!: ServiceId;

  /** صنف — متن آزاد (مثلاً لبنیات) */
  @IsString()
  @Length(1, 60)
  guild!: string;

  /** نام کسب‌وکار */
  @IsString()
  @Length(1, 80)
  businessName!: string;
}
