import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { ChatModule } from '../../chat/chat.module';
import { AdminChatsController } from './admin-chats.controller';
import { AdminChatsService } from './admin-chats.service';

/**
 * چت‌های کاربران — نمای ادمین (فقط خواندنی).
 *
 * منطق دامنه چت (ارسال/خواندن/push/شفای ادغام) در src/chat می‌ماند و
 * دست‌نخورده است؛ این ماژول فقط «پنجره مشاهده» ادمین است: لیست مکالمات
 * تازه‌ها-بالا، پیام‌های کامل یک مکالمه و آمار. هیچ write ای روی readAt
 * انجام نمی‌شود.
 */
@Module({
  imports: [AdminAuthModule, ChatModule],
  controllers: [AdminChatsController],
  providers: [AdminChatsService],
  exports: [AdminChatsService], // داشبورد ادمین برای آمار چت‌ها
})
export class AdminChatsModule {}
