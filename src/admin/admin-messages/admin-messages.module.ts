import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PushModule } from '../../push/push.module';
import { AdminMessagesController } from './admin-messages.controller';
import { AdminMessagesService } from './admin-messages.service';

/**
 * پیام مستقیم ادمین → کاربر («پشتیبانی ایمچ» سمت کاربر).
 *
 * ارسال تکی/چندتایی/همه + تاریخچه. اطلاع‌رسانی لحظه‌ای با emitToUser
 * (بدون DI — نگهدارنده io) و وب‌پوش آفلاین‌ها با PushService.
 */
@Module({
  imports: [AdminAuthModule, PushModule],
  controllers: [AdminMessagesController],
  providers: [AdminMessagesService],
})
export class AdminMessagesModule {}
