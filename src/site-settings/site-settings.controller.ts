import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SiteSettingsService } from './site-settings.service';
import { ok } from '../common/api-response';

/** تنظیمات عمومی — پیکربندی صورتحساب برای صفحات کیف پول/خریداران/بسته‌ها */
@ApiTags('site-settings')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('site-settings')
export class SiteSettingsController {
  constructor(private readonly settings: SiteSettingsService) {}

  @Post('getBillingConfig')
  @ApiOperation({ summary: 'پکیج‌های شارژ + قواعد شارژ دلخواه + نردبان + قیمت‌های پیشنهاد تامین' })
  async getBillingConfig(@Body() _body: unknown) {
    return ok(await this.settings.publicBilling());
  }
}
