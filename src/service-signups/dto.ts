import { IsIn, IsOptional, IsString, Length } from 'class-validator';

/**
 * DTOهای «ثبت‌نام سرویس‌های تخصصی ایمچ برای فروش عمده» (بازطراحی ۱۷-۱۱).
 *
 * این صفحه اعلام مسیر طرح‌های آیندهٔ ایمچ است — هر طرح فعلاً در مرحلهٔ
 * «ثبت‌نام و نیازسنجی» است و خریداران/فروشندگان علاقه‌مندی خود را ثبت
 * می‌کنند. هر سرویس دو دکمه دارد (ثبت‌نام به‌عنوان خریدار / فروشنده)؛
 * اگر کاربر با هر دو نقش اعلام علاقه کند، رکورد او role=both می‌گیرد
 * (هر کاربر در هر سرویس همچنان یک رکورد دارد).
 */

/**
 * سرویس‌های صفحهٔ /services — ۴ طرح (خواستهٔ مالک ۱۷-۱۱):
 *  • maidan-yar — میدان‌یار: تأمین بار میدان‌های تره‌بار و خریداران بزرگ
 *    محصولات کشاورزی (واسطهٔ امین: ایمچ)
 *  • factory-buy — خرید از کارخانه: خرید تکی به قیمت تولید از
 *    تولیدکننده/واردکننده
 *  • pakhshyar — پخشیار: اتصال خرده‌فروشان به تولیدکننده و واردکنندهٔ
 *    دست اول (به‌خصوص تولیدکنندگان هم‌شهری)
 *  • hamkharid — همخرید: خرید گروهی؛ تجمیع نیاز هر شهر و مناقصهٔ
 *    تأمین‌کنندگان
 */
export const SERVICE_IDS = ['maidan-yar', 'factory-buy', 'pakhshyar', 'hamkharid'] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

/** نقش ثبت‌نام — مقدار ذخیره‌شده «both» فقط خواندنی است (ادغام دو ثبت) */
export type ServiceRole = 'buyer' | 'seller';

/** POST /service-signups/save — ثبت/اصلاح ثبت‌نام در یک سرویس (upsert) */
export class SaveServiceSignupDto {
  @IsIn(SERVICE_IDS as unknown as string[])
  serviceId!: ServiceId;

  /** نقشی که کاربر با آن دکمه فرم را باز کرده — خریدار یا فروشنده */
  @IsIn(['buyer', 'seller'])
  role!: ServiceRole;

  /** صنف — متن آزاد (مثلاً تولیدکنندهٔ لبنیات / سوپرمارکت) */
  @IsString()
  @Length(1, 60)
  guild!: string;

  /** نام کسب‌وکار — اختیاری (فرم سریع) */
  @IsOptional()
  @IsString()
  @Length(0, 80)
  businessName?: string;
}
