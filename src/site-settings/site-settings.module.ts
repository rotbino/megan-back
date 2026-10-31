import { Global, Module } from '@nestjs/common';
import { SiteSettingsController } from './site-settings.controller';
import { SiteSettingsService } from './site-settings.service';

/**
 * تنظیمات پویای سایت — Global چون wallet/buyers/packages/admin بدون رقص
 * import به سرویس نیاز دارند؛ خواندن کش‌شده است و هزینه‌ای ندارد.
 */
@Global()
@Module({
  controllers: [SiteSettingsController],
  providers: [SiteSettingsService],
  exports: [SiteSettingsService],
})
export class SiteSettingsModule {}
