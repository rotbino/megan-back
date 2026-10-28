import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import {
  GetThreadDto,
  GetThreadMessagesDto,
  MarkThreadReadDto,
  SendMessageDto,
  StartThreadDto,
} from './dto';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';

@ApiTags('chat')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
/** حد نرخ ریزتر از سراسری — گفتگو — پیام‌ها مکرر اما احرازشده */
@Throttle({ default: { limit: 90, ttl: 60_000 } })
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('startThread')
  @ApiOperation({ summary: 'شروع/یافتن مکالمه روی یک آگهی (خریدار ↔ فروشنده)' })
  async startThread(@CurrentUser() user: AuthUser, @Body() dto: StartThreadDto) {
    return ok(await this.chat.startThread(user, dto));
  }

  @Post('sendMessage')
  @ApiOperation({ summary: 'ارسال پیام + push لحظه‌ای WS به گیرنده' })
  async sendMessage(@CurrentUser() user: AuthUser, @Body() dto: SendMessageDto) {
    return ok(await this.chat.sendMessage(user, dto));
  }

  @Post('getThreadMessages')
  @ApiOperation({ summary: 'پیام‌های مکالمه (باز کردن = خواندن)' })
  async getThreadMessages(@CurrentUser() user: AuthUser, @Body() dto: GetThreadMessagesDto) {
    return ok(await this.chat.getThreadMessages(user, dto));
  }

  @Post('markThreadRead')
  @ApiOperation({ summary: 'علامت خوانده‌شدن بدون واکشی پیام‌ها' })
  async markThreadRead(@CurrentUser() user: AuthUser, @Body() dto: MarkThreadReadDto) {
    return ok(await this.chat.markThreadRead(user, dto.threadId));
  }

  @Post('getConversations')
  @ApiOperation({ summary: 'لیست مکالمات من + آخرین پیام + خوانده‌نشده' })
  async getConversations(@CurrentUser() user: AuthUser) {
    return ok(await this.chat.getConversations(user));
  }

  @Post('getThread')
  @ApiOperation({ summary: 'جزئیات یک مکالمه' })
  async getThread(@CurrentUser() user: AuthUser, @Body() dto: GetThreadDto) {
    return ok(await this.chat.getThread(user, dto.threadId));
  }

  // ─── پیام‌های پشتیبانی (ادمین → کاربر؛ یک‌طرفه) ───────────────────────────

  @Post('unreadCount')
  @ApiOperation({ summary: 'بج پیام‌های خوانده‌نشده — مجموع چت + پشتیبانی' })
  async unreadCount(@CurrentUser() user: AuthUser) {
    return ok(await this.chat.getUnreadCount(user));
  }

  @Post('getMyAdminMessages')
  @ApiOperation({ summary: 'پیام‌های پشتیبانی ایمچ من — ۵۰ پیام آخر + خوانده‌نشده' })
  async getMyAdminMessages(@CurrentUser() user: AuthUser) {
    return ok(await this.chat.getMyAdminMessages(user));
  }

  @Post('markMyAdminMessagesRead')
  @ApiOperation({ summary: 'علامت خوانده‌شدن همه پیام‌های پشتیبانی' })
  async markMyAdminMessagesRead(@CurrentUser() user: AuthUser) {
    return ok(await this.chat.markMyAdminMessagesRead(user));
  }
}
