import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, type AuthUser } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ok } from '../common/api-response';
import { SupportService } from './support.service';
import { SendMessageDto } from './dto';

/**
 * گفتگوی پشتیبانی — سمت کاربر (صفحه /panel/support).
 * پاسخ‌دهی پشتیبان‌ها در admin/support (پنل مدیریت → پشتیبانی).
 */
@ApiTags('support')
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('getConversation')
  @ApiOperation({ summary: 'گفتگوی پشتیبانی من — پیام‌های پشتیبان خوانده‌شده علامت می‌خورند' })
  async getConversation(@CurrentUser() user: AuthUser) {
    return ok(await this.support.getConversation(user.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // ارسال محدود — ضد اسپم
  @Post('sendMessage')
  @ApiOperation({ summary: 'ارسال پیام به پشتیبان' })
  async sendMessage(@CurrentUser() user: AuthUser, @Body() dto: SendMessageDto) {
    return ok(await this.support.sendMessage(user.id, dto.text), 'پیام شما برای پشتیبانی ارسال شد.');
  }
}
