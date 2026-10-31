import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminId } from '../admin-auth/admin-auth.controller';
import { SiteSettingsService } from '../../site-settings/site-settings.service';
import { ok } from '../../common/api-response';

/** «تنظیمات کیف شارژ و مصرف شارژ» — همه هزینه‌ها/درصدها/سقف‌های سایت (۳۱-۱۰).
 *  ثبت خودکار در لاگ عملیات توسط AdminActionInterceptor. */
@ApiTags('admin-settings')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: SiteSettingsService) {}

  @Post('getBilling')
  @ApiOperation({ summary: 'پیکربندی کامل صورتحساب + حداقل محاسبه‌شده شارژ دلخواه' })
  async getBilling() {
    return ok(await this.settings.publicBilling());
  }

  @Post('updateBilling')
  @ApiOperation({ summary: 'ذخیره پیکربندی — نرمال‌شده و بیات‌کننده کش' })
  async updateBilling(@AdminId() adminId: string, @Body() dto: { billing: unknown }) {
    return ok(
      await this.settings.updateBilling(dto?.billing, adminId),
      'تنظیمات کیف شارژ و مصرف شارژ ذخیره شد.',
    );
  }
}
