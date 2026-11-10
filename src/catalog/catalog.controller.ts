import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';
import { CatalogService } from './catalog.service';
import { ResolveIdDto, UpdateSettingsDto, UserNameDto } from './dto';

/**
 * کاتالوگ کاربر (خواسته مالک ۱۰-۱۱ + بازنگری دور ۲/۳) — کاتالوگ فروشنده
 * همان صفحهٔ عمومی اوست (/c/{catalogId})؛ این ماژول فقط شخصی‌سازی
 * (آیدی لینک/نام برند/رنگ/آیکون) و دفترچهٔ ذخیرهٔ خریداران را نگه می‌دارد.
 * کلید همه‌جا userName فروشنده است؛ محصولات و نظرات از getSeller می‌آیند.
 *
 * عمومی (بدون ورود): resolvePublicId، getSavers — بقیه ورود می‌خواهند؛
 * مثل products گارد روش‌به‌روش است نه کلاس‌سطح.
 */
@ApiTags('catalog')
/** حد نرخ ریزتر از سراسری — ذخیره/ویرایش مکرر */
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // ─── شخصی‌سازی (پنل → مودال تنظیمات کاتالوگ) ──────────────────────────

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMySettings')
  @ApiOperation({ summary: 'تنظیمات کاتالوگ خودم — همیشه پر با پیش‌فرض‌ها' })
  async getMySettings(@CurrentUser() user: AuthUser) {
    return ok(await this.catalog.getMySettings(user.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('updateSettings')
  @ApiOperation({ summary: 'ذخیرهٔ تنظیمات — فقط فیلدهای ارسالی عوض می‌شوند؛ آیدی تکراری 409' })
  async updateSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdateSettingsDto) {
    return ok(await this.catalog.updateSettings(user.id, dto));
  }

  // ─── صفحهٔ عمومی /c/{id} (SSR — بدون ورود) ────────────────────────────

  @Post('resolvePublicId')
  @ApiOperation({ summary: 'رزولو آیدی عمومی — سفارشی یا userName؛ null = 404 فرانت' })
  async resolvePublicId(@Body() dto: ResolveIdDto) {
    return ok(await this.catalog.resolvePublicId(dto.id));
  }

  // ─── دفترچهٔ ذخیرهٔ خریدار ─────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('isSaved')
  @ApiOperation({ summary: 'وضعیت دکمهٔ ذخیره — آیا این کاتالوگ (پروفایل فروشنده) را ذخیره کرده‌ام؟' })
  async isSaved(@CurrentUser() user: AuthUser, @Body() dto: UserNameDto) {
    return ok(await this.catalog.isSaved(user.id, dto.userName));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('toggleSave')
  @ApiOperation({ summary: 'ذخیره/حذف ذخیرهٔ کاتالوگ — «کاتالوگهای ذخیره شده» پنل خریدار' })
  async toggleSave(@CurrentUser() user: AuthUser, @Body() dto: UserNameDto) {
    return ok(await this.catalog.toggleSave(user.id, dto.userName));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMySaved')
  @ApiOperation({ summary: 'کاتالوگ‌های ذخیره‌شدهٔ من — دفترچهٔ تلفن پنل خریدار' })
  async getMySaved(@CurrentUser() user: AuthUser) {
    return ok(await this.catalog.getMySaved(user.id));
  }

  @Post('getSavers')
  @ApiOperation({ summary: 'ذخیره‌کنندگان یک کاتالوگ — عمومی؛ لیست برای همه، تماس/چت فقط صاحب کاتالوگ (سمت فرانت)' })
  async getSavers(@Body() dto: UserNameDto) {
    return ok(await this.catalog.getSavers(dto.userName));
  }
}
