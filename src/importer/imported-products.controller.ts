import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../common/api-response';
import { AdminJwtAuthGuard } from '../admin/admin-auth/admin-jwt.guard';
import { UploadsService } from '../uploads/uploads.service';
import { ImportedProductsService } from './imported-products.service';
import { ImportedListingsQueryDto, ProductImagesQueryDto } from './dto';

/**
 * مدیریت آگهی‌های ایمپورت‌شده — پشت دو صفحهٔ جدید بخش «دیتا ایمپورت»
 * (خواستهٔ مالک ۱۳-۱۱):
 *
 *   • «آگهی‌ها» — تسلط بر مخلوط آگهی‌های باسکولی/خودی: منبع، ورود فروشنده،
 *     ویرایشِ خود فروشنده، وضعیت، عکس‌ها و مهرهای زمانی دقیق.
 *   • «تصاویر آگهی‌ها» — آلبوم ۲۰تایی برای یافتن واترمارک باسکول + تعویض
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
  @ApiOperation({ summary: 'آلبوم تصاویر آگهی‌ها — ۲۰تایی، فیلتر منبع/تعویض + جستجو' })
  async images(@Query() dto: ProductImagesQueryDto) {
    return ok(await this.listings.listImages(dto));
  }

  @Get('product-images/summary')
  @ApiOperation({ summary: 'آمار کلی تصاویر — کل/باسکولی/تعویض‌شده/باقی‌مانده' })
  async imagesSummary() {
    return ok(await this.listings.imagesSummary());
  }

  @Post('product-images/:id/replace')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'تعویض بایت‌های تصویر آگهی در همان کلید ذخیره‌سازی (نام/مسیر/URL دست‌نخورده)',
    description:
      'گردش‌کار پاک‌کردن واترمارک باسکول: فایل اصلی را ذخیره کنید، در Paint واترمارک را پاک کنید و همین‌جا آپلود کنید. ' +
      'فایل اصلی و تامبنیل در همان کلید قبلی بازنویسی می‌شوند؛ واترمارک آیمچِ داخل پیکسل‌ها حفظ و دوباره اعمال نمی‌شود.',
  })
  async replace(@Param('id') id: string, @Req() req: FastifyRequest) {
    const { file } = await this.uploads.readMultipart(req);
    const adminReq = req as FastifyRequest & { adminUsername?: string };
    return ok(
      await this.uploads.replaceInPlace(id, file, adminReq.adminUsername ?? 'admin'),
      'تصویر در همان نام و مسیر جایگزین شد؛ تامبنیل هم از روی تصویر تازه بازساخته شد.',
    );
  }
}
