import { Module } from '@nestjs/common';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminActionsModule } from '../admin-actions/admin-actions.module';

/** داشبورد عملیاتی مدیریت — شمارنده‌ها + روند ۳۰ روزه + درآمد + فعالیت اخیر (A5) */
@Module({
  imports: [AdminAuthModule, AdminActionsModule], // گارد ادمین + سرویس لاگ عملیات
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminDashboardModule {}
