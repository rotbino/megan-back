import { Body, Controller, Post, UseGuards } from '@nestjs/common';
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

  @Post('sendMessage')
  @ApiOperation({ summary: 'پاسخ پشتیبان به کاربر' })
  async sendMessage(
    @AdminId() _adminId: string,
    @AdminUsername() adminUsername: string,
    @Body() dto: SendSupportReplyDto,
  ) {
    const msg = await this.support.sendMessage(adminUsername, dto.userId, dto.text);
    if (!msg) throw AppError.notFound('کاربر یافت نشد.');
    return ok(msg, 'پاسخ شما برای کاربر ارسال شد.');
  }

  @Post('getStats')
  @ApiOperation({ summary: 'آمار پشتیبانی — بج منو + صف انتظار داشبورد' })
  async getStats() {
    return ok(await this.support.getStats());
  }
}
