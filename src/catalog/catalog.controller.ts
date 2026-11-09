import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';
import { CatalogService } from './catalog.service';
import { CreateCatalogDto, PageIdDto, UpdateCatalogDto } from './dto';

/**
 * کاتالوگ محصول (خواسته مالک ۱۰-۱۱) — صفحهٔ عمومی مستقل فروشنده.
 * عمومی (بدون ورود): checkPageId، getByPageId (SSR)، getSavers — بقیه ورود
 * می‌خواهند؛ مثل products گارد روش‌به‌روش است نه کلاس‌سطح.
 */
@ApiTags('catalog')
/** حد نرخ ریزتر از سراسری — ساخت/ویرایش/ذخیرهٔ مکرر */
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Post('checkPageId')
  @ApiOperation({ summary: 'بررسی یکتایی آیدی پیج — عمومی؛ قالب نامعتبر هم false می‌دهد' })
  async checkPageId(@Body() dto: PageIdDto) {
    return ok(await this.catalog.checkPageId(dto.pageId));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('create')
  @ApiOperation({ summary: 'ساخت کاتالوگ — آیدی یکتا + رنگ برند + اینستاگرام/واتساپ اختیاری' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateCatalogDto) {
    return ok(await this.catalog.create(user, dto), 'کاتالوگ شما ساخته شد.');
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('update')
  @ApiOperation({ summary: 'ویرایش تنظیمات — آیدی/رنگ/اینستاگرام/واتساپ؛ آیدی جدید باید آزاد باشد' })
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateCatalogDto) {
    return ok(await this.catalog.update(user, dto), 'تنظیمات کاتالوگ ذخیره شد.');
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMine')
  @ApiOperation({ summary: 'تنظیمات کاتالوگ خودم — null یعنی هنوز نساخته‌ام' })
  async getMine(@CurrentUser() user: AuthUser) {
    return ok(await this.catalog.getMine(user.id));
  }

  @Post('getByPageId')
  @ApiOperation({ summary: 'کاتالوگ + صاحبش + شمار ذخیره‌کنندگان — SSR صفحهٔ عمومی؛ null = 404' })
  async getByPageId(@Body() dto: PageIdDto) {
    return ok(await this.catalog.getByPageId(dto.pageId));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('isSaved')
  @ApiOperation({ summary: 'وضعیت دکمهٔ ذخیره — آیا این کاتالوگ را ذخیره کرده‌ام؟' })
  async isSaved(@CurrentUser() user: AuthUser, @Body() dto: PageIdDto) {
    return ok(await this.catalog.isSaved(user.id, dto.pageId));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('toggleSave')
  @ApiOperation({ summary: 'ذخیره/حذف ذخیرهٔ کاتالوگ — «کاتالوگهای ذخیره شده» پنل خریدار' })
  async toggleSave(@CurrentUser() user: AuthUser, @Body() dto: PageIdDto) {
    return ok(await this.catalog.toggleSave(user, dto.pageId));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMySaved')
  @ApiOperation({ summary: 'کاتالوگ‌های ذخیره‌شدهٔ من — دفترچهٔ تلفن پنل خریدار' })
  async getMySaved(@CurrentUser() user: AuthUser) {
    return ok(await this.catalog.getMySaved(user.id));
  }

  @Post('getSavers')
  @ApiOperation({ summary: 'ذخیره‌کنندگان یک کاتالوگ — عمومی؛ لیست برای همه، تماس/چت فقط صاحب پیج (سمت فرانت)' })
  async getSavers(@Body() dto: PageIdDto) {
    return ok(await this.catalog.getSavers(dto.pageId));
  }
}
