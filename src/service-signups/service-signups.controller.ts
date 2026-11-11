import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';
import { ServiceSignupsService } from './service-signups.service';
import { SaveServiceSignupDto } from './dto';

/**
 * ثبت‌نام فروشندگان در سرویس‌های تخصصی ارزش‌افزوده (خواستهٔ مالک ۱۱-۱۲) —
 * صفحهٔ عمومی /services؛ مهمان قبل از فرم از مودال ورود رد می‌شود (فرانت).
 */
@ApiTags('service-signups')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('service-signups')
export class ServiceSignupsController {
  constructor(private readonly signups: ServiceSignupsService) {}

  @Post('getMine')
  @ApiOperation({ summary: 'ثبت‌نام‌های من در سرویس‌های تخصصی — وضعیت باکس‌های صفحهٔ /services' })
  async getMine(@CurrentUser() user: AuthUser) {
    return ok(await this.signups.getMine(user.id));
  }

  /** فرم — حد نرخ پایین‌تر از پیش‌فرض (ارسال مکرر بی‌معنی) */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('save')
  @ApiOperation({ summary: 'ثبت/اصلاح ثبت‌نام در یک سرویس (صنف + نام کسب‌وکار) — upsert' })
  async save(@CurrentUser() user: AuthUser, @Body() dto: SaveServiceSignupDto) {
    return ok(await this.signups.save(user.id, dto), 'ثبت‌نام شما دریافت شد.');
  }
}
