import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminSupportController } from './admin-support.controller';
import { AdminSupportService } from './admin-support.service';

/**
 * چت‌های پشتیبانی — نمای ادمین (پاسخ‌دهنده).
 * منطق سمت کاربر در src/support است؛ این ماژول لیست گفتگوها، پیام‌های
 * یک کاربر، پاسخ پشتیبان و آمار (بج منو/داشبورد) را می‌دهد.
 */
@Module({
  imports: [AdminAuthModule],
  controllers: [AdminSupportController],
  providers: [AdminSupportService],
  exports: [AdminSupportService], // داشبورد ادمین برای آمار پشتیبانی
})
export class AdminSupportModule {}
