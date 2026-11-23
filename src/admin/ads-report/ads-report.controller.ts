import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdsReportService } from './ads-report.service';
import { GetAdsReportDto } from './dto';
import { ok } from '../../common/api-response';

/**
 * گزارش آگهی‌ها بر پایهٔ گروه‌بندی جدید (تاکسونومی v2) — صفحهٔ مهاجرت موازی:
 * سایت عمومی همچنان روی دستهٔ پاسکال است؛ این گزارش آگهی‌ها را از طریق جدول
 * نگاشت استاتیک (scripts/gen-taxonomy-map.ts) روی درخت جدید نشان می‌دهد.
 * فیلتر شهر/استان + جستجو + وضعیت + اتریبیوت‌های پایلوت (نخود/پفک).
 */
@ApiTags('admin-ads-report')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/ads-report')
export class AdsReportController {
  constructor(private readonly report: AdsReportService) {}

  @Post('getTree')
  @ApiOperation({ summary: 'درخت ۱۵-ریشه‌ای v2 + شمار آگهی هر گره + پوشش نگاشت' })
  async getTree() {
    return ok(await this.report.getTree());
  }

  @Post('getReport')
  @ApiOperation({ summary: 'لیست آگهی‌ها روی دستهٔ جدید — فیلتر گره/شهر/استان/وضعیت/جستجو/اتریبیوت' })
  async getReport(@Body() dto: GetAdsReportDto) {
    return ok(await this.report.getReport(dto));
  }
}
