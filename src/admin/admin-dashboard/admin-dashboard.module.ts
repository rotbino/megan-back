import { Module } from '@nestjs/common';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

/** داشبورد مدیریت — آمار زنده (فاز A1: شمارنده‌ها؛ نمودارها در A5) */
@Module({
  imports: [AdminAuthModule], // گارد ادمین
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminDashboardModule {}
