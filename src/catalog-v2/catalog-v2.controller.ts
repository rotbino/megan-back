import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdsReportService } from '../admin/ads-report/ads-report.service';
import { GetCatalogListDto } from '../admin/ads-report/dto';
import { ok } from '../common/api-response';

/**
 * کاتالوگ عمومی روی تاکسونومی v2 — صفحهٔ /product-filter.
 *
 * «صفحهٔ مهاجرت موازی» بی‌احراز هویت: سایت عمومی همچنان روی دستهٔ باسکول
 * است؛ این دو اندپوینت درخت جدید و آگهی‌های confirmed را برای صفحهٔ
 * فیلتر عمومی می‌دهند. شمارهٔ تلفن فروشنده هرگز برنمی‌گردد (سرویس
 * تضمین می‌کند) و 'unmapped' ادمینی اینجا معنا ندارد.
 */
@ApiTags('catalog-v2')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('catalog/v2')
export class CatalogV2Controller {
  constructor(private readonly report: AdsReportService) {}

  @Post('getTree')
  @ApiOperation({ summary: 'درخت عمیق v2 + شمار آگهی confirmed هر گره' })
  async getTree() {
    return ok(await this.report.getTree());
  }

  @Post('getList')
  @ApiOperation({ summary: 'آگهی‌های confirmed روی دستهٔ جدید — فیلتر گره/شهر/جستجو/اتریبیوت/سورت' })
  async getList(@Body() dto: GetCatalogListDto) {
    return ok(await this.report.getPublicList(dto));
  }
}
