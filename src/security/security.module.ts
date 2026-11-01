import { Global, Module } from '@nestjs/common';
import { SecurityService } from './security.service';
import { SecurityGuard } from './security.guard';

/**
 * ─── امنیت داده‌های تماس (خواستهٔ مالک ۱-۱۱) ────────────────────────────────
 *
 * شماره‌های موبایل کسب‌وکارها با زحمت جمع شده‌اند و نباید به سرقت بروند.
 * لایه‌های محافظت (به‌ترتیب از بیرون به داخل):
 *
 *  ۱. توکن — شماره فقط از سرویس‌های اختصاصی توکندار می‌آید؛ هرگز در دیتای
 *     لیست/جزئیات عمومی نیست (getProductList/getProductById/getSeller).
 *  ۲. سهمیهٔ روزانه — رایگان ۱۰ کاربر در روز، بستهٔ فعال ۳۰ کاربر
 *     (CallsService.assertDailyQuota).
 *  ۳. حد نرخ ریز — روی خود مسیرهای آشکارسازی (@Throttle متد).
 *  ۴. همین ماژول — الگوی سوءاستفاده:
 *       • چکش‌کاریِ آشکارسازی توسط یک کاربر (چند برابر سهمیه) → کاربر و
 *         شمارهٔ موبایلش همان لحظه بلاک می‌شوند (isActive=false + ابطال همهٔ
 *         نشست‌ها) و دیگر نمی‌توانند وارد شوند.
 *       • مزرعهٔ حساب — یک IP پشت چند کاربر مختلف آشکارسازی کند → IP
 *         ۲۴ ساعت بلاک می‌شود (ThrottlerGuard بر پایهٔ IP واقعی trustProxy).
 *
 * شمارنده‌ها درون‌حافظه‌اند (تک‌نمونه MVP)؛ با Redis در مقیاس بعدی.
 */
@Global()
@Module({
  providers: [SecurityService, SecurityGuard],
  exports: [SecurityService],
})
export class SecurityModule {}
