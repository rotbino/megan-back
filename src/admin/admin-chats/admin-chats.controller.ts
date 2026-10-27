import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminChatsService } from './admin-chats.service';
import { GetThreadListDto, ThreadIdDto } from './dto';
import { ok } from '../../common/api-response';

/**
 * چت‌های کاربران — نمای ادمین (فقط خواندنی).
 *
 * جریان MVP: پیام خریدار → ادمین در پنل می‌بیند → به فروشنده زنگ می‌زند
 * که بیاید جواب بدهد. هیچ اندپوینتی اینجا خوانده‌شدن را تغییر نمی‌دهد؛
 * پرچم/بج «خوانده‌نشده» فقط با خواندن واقعی توسط خود کاربر صفر می‌شود.
 * همه اندپوینت‌ها get* هستند → در AdminAction به‌عنوان عملیات ثبت نمی‌شوند.
 */
@ApiTags('admin-chats')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 90, ttl: 60_000 } })
@Controller('admin/chats')
export class AdminChatsController {
  constructor(private readonly chats: AdminChatsService) {}

  @Post('getThreadList')
  @ApiOperation({
    summary:
      'لیست مکالمات (تازه‌ترین بالا) + طرف‌ها + آخرین پیام + خوانده‌نشده + «در انتظار پاسخ فروشنده»',
  })
  async getThreadList(@Body() dto: GetThreadListDto) {
    return ok(await this.chats.getThreadList(dto));
  }

  @Post('getThreadMessages')
  @ApiOperation({
    summary: 'کل پیام‌های یک مکالمه — فقط خواندنی؛ خوانده‌شده علامت نمی‌خورد',
  })
  async getThreadMessages(@Body() dto: ThreadIdDto) {
    return ok(await this.chats.getThreadMessages(dto.threadId));
  }

  @Post('getChatStats')
  @ApiOperation({ summary: 'آمار چت‌ها برای داشبورد/صفحه چت‌ها' })
  async getChatStats() {
    return ok(await this.chats.getChatStats());
  }
}
