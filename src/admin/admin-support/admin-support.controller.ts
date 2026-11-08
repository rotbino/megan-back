import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminId } from '../admin-auth/admin-auth.controller';
import { AdminUsername } from '../admin-users/admin-users.controller';
import { AppError } from '../../common/errors/app-error';
import { ok } from '../../common/api-response';
import { AdminSupportService } from './admin-support.service';
import { GetSupportThreadListDto, SendSupportReplyDto, UserIdDto } from './dto';

/**
 * چت‌های پشتیبانی — نمای ادمین (پاسخ‌دهنده).
 * پنل مدیریت → پشتیبانی → چت‌های پشتیبانی (خواستهٔ مالک ۸-۱۱ دور ۲۱).
 */
@ApiTags('admin/support')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly support: AdminSupportService) {}

  @Post('getThreadList')
  @ApiOperation({ summary: 'گفتگوهای پشتیبانی — تازه‌ترین بالا + بج خوانده‌نشده' })
  async getThreadList(@Body() dto: GetSupportThreadListDto) {
    return ok(await this.support.getThreadList(dto));
  }

  @Post('getThreadMessages')
  @ApiOperation({ summary: 'کل گفتگوی یک کاربر — پیام‌های کاربر خوانده‌شده علامت می‌خورند' })
  async getThreadMessages(@Body() dto: UserIdDto) {
    const data = await this.support.getThreadMessages(dto.userId);
    if (!data) throw AppError.notFound('کاربر یافت نشد.');
    return ok(data);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } }) // آپلود محدود
  @Post('uploadFile')
  @ApiOperation({ summary: 'آپلود پیوست پاسخ پشتیبان — تصویر/ویدئو/سند تا ۵MB' })
  async uploadFile(@AdminId() adminId: string, @Req() req: FastifyRequest) {
    return ok(await this.support.uploadFile(adminId, req));
  }

  @Post('sendMessage')
  @ApiOperation({ summary: 'پاسخ پشتیبان به کاربر — متن یا فایل + کپشن (push لحظه‌ای به کاربر)' })
  async sendMessage(
    @AdminId() adminId: string,
    @AdminUsername() adminUsername: string,
    @Body() dto: SendSupportReplyDto,
  ) {
    const msg = await this.support.sendMessage(adminUsername, adminId, dto.userId, dto);
    if (!msg) throw AppError.notFound('کاربر یافت نشد.');
    return ok(msg, 'پاسخ شما برای کاربر ارسال شد.');
  }

  @Post('getStats')
  @ApiOperation({ summary: 'آمار پشتیبانی — بج منو + صف انتظار داشبورد' })
  async getStats() {
    return ok(await this.support.getStats());
  }
}
