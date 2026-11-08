import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { IsBoolean, IsOptional } from 'class-validator';
import { JwtAuthGuard, type AuthUser } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ok } from '../common/api-response';
import { SupportService } from './support.service';
import { SendMessageDto } from './dto';

class GetConversationDto {
  /** true = صفحهٔ پشتیبانی واقعاً مرئی است؛ پیام‌های پشتیبان خوانده می‌شوند.
   *  پیش‌فرض false — fetch خالص (polling/WS) بج را نمی‌شکند (رفع باگ دور ۲۴) */
  @IsOptional()
  @IsBoolean()
  markRead?: boolean;
}

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
  @ApiOperation({ summary: 'گفتگوی پشتیبانی من — خواندن فقط با markRead صریح (تب مرئی)' })
  async getConversation(@CurrentUser() user: AuthUser, @Body() dto: GetConversationDto) {
    return ok(await this.support.getConversation(user.id, dto.markRead === true));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('markRead')
  @ApiOperation({ summary: 'خواندن پاسخ‌های پشتیبان — باز کردن واقعی صفحهٔ پشتیبانی' })
  async markRead(@CurrentUser() user: AuthUser) {
    return ok(await this.support.markRead(user.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } }) // آپلود محدود — ضد سوءاستفاده
  @Post('uploadFile')
  @ApiOperation({ summary: 'آپلود پیوست گفتگوی پشتیبانی — تصویر/ویدئو/سند تا ۵MB' })
  async uploadFile(@Req() req: FastifyRequest, @CurrentUser() user: AuthUser) {
    return ok(await this.support.uploadFile(user.id, req));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // ارسال محدود — ضد اسپم
  @Post('sendMessage')
  @ApiOperation({ summary: 'ارسال پیام به پشتیبان — متن یا فایل + کپشن' })
  async sendMessage(@CurrentUser() user: AuthUser, @Body() dto: SendMessageDto) {
    return ok(
      await this.support.sendMessage(user.id, dto),
      'پیام شما برای پشتیبانی ارسال شد.',
    );
  }
}
