import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../common/api-response';
import { AdminJwtAuthGuard } from '../admin/admin-auth/admin-jwt.guard';
import { UploadsService } from '../uploads/uploads.service';
import { BuskoolWatermarkService } from './buskool-wm.service';
import { ImportedProductsService } from './imported-products.service';
import {
  ImportedListingsQueryDto,
  ProductFilesQueryDto,
  ProductImagesQueryDto,
  ReviewFilesDto,
  SetFileWatermarkDto,
  WmBatchDto,
} from './dto';

/**
 * مدیریت آگهی‌های ایمپورت‌شده — پشت دو صفحهٔ جدید بخش «دیتا ایمپورت»
 * (خواستهٔ مالک ۱۳-۱۱):
 *
 *   • «آگهی‌ها» — تسلط بر مخلوط آگهی‌های پاسکالی/خودی: منبع، ورود فروشنده،
 *     ویرایشِ خود فروشنده، وضعیت، عکس‌ها و مهرهای زمانی دقیق.
 *   • «تصاویر آگهی‌ها» — آلبوم ۲۰تایی برای یافتن واترمارک پاسکال + تعویض
 *     درجا (همان کلید/نام/مسیر، تامبنیل هم بازساخته می‌شود).
 *
 * همهٔ اندپوینت‌ها پشت AdminJwtAuthGuard (توکن ادمین، راز جدا) هستند.
 */
@ApiTags('importer')
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@UseGuards(AdminJwtAuthGuard)
@Controller('importer')
export class ImportedProductsController {
  constructor(
    private readonly listings: ImportedProductsService,
    private readonly uploads: UploadsService,
    private readonly wm: BuskoolWatermarkService,
  ) {}

  @Get('products')
  @ApiOperation({ summary: 'فهرست آگهی‌ها — فیلتر منبع/ورود فروشنده/ویرایش/وضعیت/عکس + سورت + صفحه‌بندی + آمار' })
  async list(@Query() dto: ImportedListingsQueryDto) {
    return ok(await this.listings.list(dto));
  }

  @Get('products/summary')
  @ApiOperation({ summary: 'آمار کلی آگهی‌ها — کارت‌های بالای صفحه' })
  async summary() {
    return ok(await this.listings.summary());
  }

  @Get('product-images')
  @ApiOperation({ summary: 'آلبوم تصاویر آگهی‌ها — ۵۰تایی، سورت (آپدیت/ثبت/آید آگهی/حجم) + بازهٔ تاریخ + فیلتر منبع/تعویض + جستجو' })
  async images(@Query() dto: ProductImagesQueryDto) {
    return ok(await this.listings.listImages(dto));
  }

  @Get('product-images/summary')
  @ApiOperation({ summary: 'آمار کلی تصاویر — کل/پاسکالی/تعویض‌شده/باقی‌مانده' })
  async imagesSummary() {
    return ok(await this.listings.imagesSummary());
  }

  @Post('product-images/:id/replace')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'تعویض تصویر آگهی با کلید نسخه‌دار تازه — کش‌ها فوری می‌شکنند (۱۷-۱۱)',
    description:
      'گردش‌کار پاک‌کردن واترمارک پاسکال: فایل اصلی را ذخیره کنید، در Paint واترمارک را پاک کنید و همین‌جا آپلود کنید. ' +
      'بایت‌های تازه در کلید تازه «name.r<epoch>.ext» در همان پوشه می‌نشینند (URL جدید ⇒ مرورگر/CDN/بهینه‌ساز تصویر همان لحظه نسخهٔ تازه را می‌گیرند)، ' +
      'تامبنیل در کلید تازه بازساخته و کلیدهای قدیمی حذف می‌شوند؛ ردیف File همان می‌ماند و کلید قبلی در metadata.replacedFromKey یادآوری می‌شود.',
  })
  async replace(@Param('id') id: string, @Req() req: FastifyRequest) {
    const { file } = await this.uploads.readMultipart(req);
    const adminReq = req as FastifyRequest & { adminUsername?: string };
    return ok(
      await this.uploads.replaceInPlace(id, file, adminReq.adminUsername ?? 'admin'),
      'تصویر جایگزین شد؛ کلید نسخه‌دار تازه ساخته شد و همهٔ کش‌ها فوری می‌شکنند.',
    );
  }

  // ─── «فقط تصاویر» — شکار واترمارک (خواستهٔ مالک ۱۹-۱۱) ─────────────────

  @Get('product-files')
  @ApiOperation({
    summary: 'کاش‌های تنها — فقط خود تصویر + شناسهٔ فایل + علامت واترمارک (نه عنوان، نه هیچ دادهٔ دیگر) + فیلتر واترمارک',
  })
  async listFiles(@Query() dto: ProductFilesQueryDto) {
    return ok(await this.listings.listProductFiles(dto));
  }

  @Post('product-files/:id/watermark')
  @ApiOperation({
    summary: 'دو تیک «دارد/ندارد» (خواستهٔ مالک ۱۹-۱۱ شب): true = صف حذف | false = بررسی‌شده بدون واترمارک | null = پس‌گرفتن بررسی',
  })
  async setWatermark(@Param('id') id: string, @Body() dto: SetFileWatermarkDto) {
    return ok(
      await this.listings.setFileWatermark(id, dto.hasWatermark),
      dto.hasWatermark === true
        ? 'ثبت شد: واترمارک دارد — در صف حذف قرار گرفت.'
        : dto.hasWatermark === false
          ? 'ثبت شد: بدون واترمارک — از لیست باقی‌مانده خارج شد.'
          : 'بررسی پس گرفته شد — فایل به لیست باقی‌مانده برگشت.',
    );
  }

  // ── حذف خودکار واترمارک پاسکال (خواستهٔ مالک ۱۹-۱۱: دکمه در تب واترمارک +
  //    تست تک‌تصویر) — پورت TS همان الگوریتم پایتون، مستقیم روی بک‌اند ─────

  @Post('product-files/:id/wm-preview')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    summary: 'پیش‌نمایش حذف واترمارک پاسکال — بدون هیچ تغییری در دیتابیس/استوریج',
    description:
      'تصویر دانلود، واترمارک تشخیص و حذف می‌شود و «قبل | بعد» + نسخهٔ کامل پاک‌شده به‌صورت data URL برمی‌گردد — برای دکمهٔ تست زیر هر تصویر.',
  })
  async wmPreview(@Param('id') id: string) {
    return ok(await this.wm.previewOne(id));
  }

  @Post('product-files/:id/wm-apply')
  // (۲۱-۱۱) اصلاح موازی: مالک ده‌ها دکمهٔ «اصلاح» را همزمان می‌زند — هر
  // درخواست مستقل پردازش می‌شود؛ سقف ۶۰تاییِ کنترلر این جریان را می‌بندد
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @ApiOperation({
    summary: 'اعمال حذف واترمارک — تعویض درجا با کلید نسخه‌دار تازه (آروان) + مهر اصلاح',
    description: 'قابل فراخوانی موازی — هر تصویر مستقل دانلود/پاک/تعویض می‌شود.',
  })
  async wmApply(@Param('id') id: string, @Req() req: FastifyRequest) {
    const adminReq = req as FastifyRequest & { adminUsername?: string };
    const r = await this.wm.applyOne(id, `${adminReq.adminUsername ?? 'admin'} · buskool-wm`);
    return ok(
      r,
      r.status === 'removed' && r.file
        ? 'واترمارک حذف و تصویر جایگزین شد — تیک «اصلاح شد» خورد.'
        : r.status === 'not_found'
          ? 'واترمارک پاسکال در این تصویر پیدا نشد — دستی بررسی کنید.'
          : 'تصویر جایگزین نشد (کلید ذخیره‌سازی ندارد).',
    );
  }

  @Post('product-files/wm-batch')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'دستهٔ بعدی صف حذف واترمارک — UI حلقه می‌زند تا صف خالی شود',
    description:
      'تا limit فایل علامت‌خورده را پردازش می‌کند (دانلود → تشخیص → حذف → تعویض درجا). تعداد باقی‌ماندهٔ صف هم برمی‌گردد.',
  })
  async wmBatch(@Body() dto: WmBatchDto, @Req() req: FastifyRequest) {
    const adminReq = req as FastifyRequest & { adminUsername?: string };
    return ok(
      await this.wm.batch(
        dto.limit ?? 5,
        `${adminReq.adminUsername ?? 'admin'} · buskool-wm`,
        dto.exclude,
      ),
    );
  }

  @Post('product-files/review-batch')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'دکمهٔ «بررسی شد» (خواستهٔ مالک ۲۱-۱۱) — مهر گروهی بررسی روی دستهٔ فعلی',
    description:
      'همهٔ تصاویرِ صفحهٔ فعلی مهر watermarkReviewedAt می‌خورند و دیگر هرگز در صفحهٔ بررسی لود نمی‌شوند؛ ' +
      'دستهٔ بعدیِ نیاز‌به‌بررسی جای آن‌ها را می‌گیرد. هیچ فیلد/تب/صفحه‌بندی جدیدی درست نمی‌کند — همان فیلد «بررسی‌شده».',
  })
  async reviewBatch(@Body() dto: ReviewFilesDto) {
    return ok(
      await this.listings.reviewFilesBatch(dto.ids),
      'دستهٔ فعلی بررسی شد — تصاویر بعدیِ نیازمند بررسی بارگذاری می‌شوند.',
    );
  }
}
