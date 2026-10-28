import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminId } from '../admin-auth/admin-auth.controller';
import { AdminUsername } from '../admin-users/admin-users.controller';
import { AdminMessagesService } from './admin-messages.service';
import { GetUserMessagesDto, SendToAllDto, SendToUserDto, SendToUsersDto } from './dto';
import { ok } from '../../common/api-response';

/**
 * پیام مستقیم ادمین → کاربر (یک‌طرفه؛ مکالمه «پشتیبانی ایمچ» سمت کاربر).
 *
 * سه راه ارسال: تکی (صفحه جزئیات/ردیف لیست)، چندتایی (چک‌باکس‌های لیست
 * کاربران) و گروهی به همه با مخاطب اختیاری. خوانده‌شدن per-user در
 * AdminMessage دیده می‌شود — تاریخچه در تب «پیام‌ها» صفحه جزئیات کاربر.
 */
@ApiTags('admin-messages')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/messages')
export class AdminMessagesController {
  constructor(private readonly messages: AdminMessagesService) {}

  @Post('sendToUser')
  @ApiOperation({ summary: 'ارسال پیام به یک کاربر + push WS/وب‌پوش لحظه‌ای' })
  async sendToUser(
    @AdminId() _adminId: string,
    @AdminUsername() adminUsername: string,
    @Body() dto: SendToUserDto,
  ) {
    return ok(await this.messages.sendToUser(adminUsername, dto), 'پیام برای کاربر ارسال شد.');
  }

  @Post('sendToUsers')
  @ApiOperation({ summary: 'ارسال پیام به چند کاربر انتخابی (حداکثر ۵۰۰)' })
  async sendToUsers(
    @AdminId() _adminId: string,
    @AdminUsername() adminUsername: string,
    @Body() dto: SendToUsersDto,
  ) {
    const r = await this.messages.sendToUsers(adminUsername, dto);
    return ok(
      r,
      r.skipped > 0
        ? `پیام برای ${r.sent} کاربر ارسال شد (${r.skipped} شناسه نامعتبر نادیده گرفته شد).`
        : `پیام برای ${r.sent} کاربر ارسال شد.`,
    );
  }

  @Post('sendToAll')
  @ApiOperation({ summary: 'ارسال پیام به همه کاربران — با مخاطب اختیاری (فعال/فروشنده/خریدار/احرازشده)' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // ارسال انبوه گران است — سیل‌بند جدا
  async sendToAll(
    @AdminId() _adminId: string,
    @AdminUsername() adminUsername: string,
    @Body() dto: SendToAllDto,
  ) {
    const r = await this.messages.sendToAll(adminUsername, dto);
    return ok(r, `پیام برای ${r.sent} کاربر (مخاطب: ${r.audience}) ارسال شد.`);
  }

  @Post('getUserMessages')
  @ApiOperation({ summary: 'تاریخچه پیام‌های پشتیبانی یک کاربر + خوانده‌نشده' })
  async getUserMessages(@Body() dto: GetUserMessagesDto) {
    return ok(await this.messages.getUserMessages(dto));
  }
}
