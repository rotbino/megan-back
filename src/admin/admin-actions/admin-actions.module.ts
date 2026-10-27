import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminActionsController } from './admin-actions.controller';
import { AdminActionsService } from './admin-actions.service';
import { AdminActionInterceptor } from './admin-action.interceptor';

/**
 * فاز A5 — ماژول لاگ عملیات ادمین.
 *
 * AdminActionsService export می‌شود تا AdminModule بتواند
 * AdminActionInterceptor را به‌صورت APP_INTERCEPTOR (سراسری) رجیستر کند —
 * interceptor فقط درخواست‌های احرازشده ادمین (request.adminId) را لاگ می‌کند.
 */
@Module({
  imports: [AdminAuthModule],
  controllers: [AdminActionsController],
  providers: [AdminActionsService, AdminActionInterceptor],
  exports: [AdminActionsService, AdminActionInterceptor],
})
export class AdminActionsModule {}
