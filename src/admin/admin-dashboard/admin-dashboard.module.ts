import { Module } from '@nestjs/common';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminActionsModule } from '../admin-actions/admin-actions.module';
import { AdminChatsModule } from '../admin-chats/admin-chats.module';
import { AdminCallsModule } from '../admin-calls/admin-calls.module';

/** داشبورد عملیاتی مدیریت — شمارنده‌ها + روند ۳۰ روزه + درآمد + فعالیت اخیر (A5) */
@Module({
  imports: [AdminAuthModule, AdminActionsModule, AdminChatsModule, AdminCallsModule], // گارد ادمین + سرویس لاگ عملیات + آمار چت/تماس
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminDashboardModule {}
