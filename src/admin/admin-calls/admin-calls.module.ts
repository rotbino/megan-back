import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminCallsController } from './admin-calls.controller';
import { AdminCallsService } from './admin-calls.service';

/**
 * گزارش تماس‌های کاربران — نمای ادمین (فقط خواندنی).
 * ثبت رویداد در src/calls (سمت کاربر) انجام می‌شود؛ این ماژول فقط
 * گزارش می‌دهد: لیست + آمار. هیچ write ای وجود ندارد.
 */
@Module({
  imports: [AdminAuthModule],
  controllers: [AdminCallsController],
  providers: [AdminCallsService],
  exports: [AdminCallsService], // داشبورد ادمین برای آمار تماس‌ها
})
export class AdminCallsModule {}
