import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminSettingsController } from './admin-settings.controller';

/** تنظیمات ادمین — سرویس در SiteSettingsModule سراسری است؛ این‌جا فقط مسیر
 *  admin/settings/* را با گارد ادمین فراهم می‌کند. */
@Module({
  imports: [AdminAuthModule],
  controllers: [AdminSettingsController],
})
export class AdminSettingsModule {}
