/**
 * آپدیت قیمت‌ها + شناسایی کاربران جدید باسکول (۲۱-۱۱) — اندپوینت‌های
 * گام‌محور و سرورلس‌پسند: هر فراخوانی فقط یک تکهٔ ۱۰۰۰تایی کار می‌کند و
 * فرانت حلقهٔ بچ‌ها را با ۵ ثانیه فاصله می‌چرخاند (خواستهٔ مالک:
 * «یک تیر برای دو نشان» — هم آپدیت قیمت، هم کاربران جدید، در یک صفحه).
 */
import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../common/api-response';
import { PriceUpdateService } from './price-update.service';
import { ExtractUserDto, FetchPhoneDto, UpdateScanDto } from './dto';

@ApiTags('importer')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('importer/update')
export class PriceUpdateController {
  constructor(private readonly priceUpdate: PriceUpdateService) {}

  @Post('scan')
  @ApiOperation({
    summary:
      'یک تکه از جدیدترین آگهی‌های باسکول (بدون کوکی، sort_by=RD) — آپدیت قیمت/موجودی/حداقل‌سفارش آگهی‌های موجود + کاربران تازه‌ثبت‌نامِ غایب؛ بین دو فراخوانی حداقل ۵ ثانیه فاصله باشد (گارد سرور هم هست)',
  })
  async scan(@Body() dto: UpdateScanDto) {
    return ok(
      await this.priceUpdate.scan(dto.adminPhone, {
        from: dto.from,
        to: dto.to,
        updatePrices: dto.updatePrices,
        recentDays: dto.recentDays,
      }),
    );
  }

  @Post('fetch-phone')
  @ApiOperation({
    summary:
      'شمارهٔ موبایل یک فروشندهٔ باسکول (get_seller_phone_number با کوکی) — هر کوکی فقط ۲۰ شماره؛ سهمیهٔ باقی‌مانده در پاسخ',
  })
  async fetchPhone(@Body() dto: FetchPhoneDto) {
    return ok(await this.priceUpdate.fetchPhone(dto.adminPhone, { sId: dto.sId, pId: dto.pId }));
  }

  @Post('extract-user')
  @ApiOperation({
    summary:
      'پیش‌ایمپورت یک یوزرنیم باسکول — اول چک bUserName در ایمچ (موجود = بدون تماس با باسکول)؛ غایب = گرفتن شمارهٔ موبایل برای شروع ایمپورت کامل',
  })
  async extractUser(@Body() dto: ExtractUserDto) {
    return ok(await this.priceUpdate.extractUser(dto.adminPhone, { userName: dto.userName }));
  }
}
