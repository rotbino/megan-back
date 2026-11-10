import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';
import { BuyerBookService } from './buyer-book.service';
import { BuyerUserNameDto, ResolveBookIdDto, UpdateBookSettingsDto } from './dto';

/**
 * دفتر خرید (خواسته مالک ۱۰-۱۱ دور ۵) — قرینهٔ کاتالوگ فروشنده.
 * خریدار دفتر خرید دارد (کالاهای خرید دوره‌ای‌اش در /b/{bookId}) که
 * فروشندهٔ دارندهٔ بسته ذخیره می‌کند: لیست مشتری بالقوه در تب «دفاتر
 * ذخیره شده» پنل خریداران. کلید همه‌جا userName خریدار است؛ کالاها از
 * BuyerCategory (جریان بازبینی ادمین) می‌آیند.
 *
 * عمومی (بدون ورود): resolvePublicId — پوستهٔ برند SSR؛ getPublic ورود
 * می‌خواهد و محتوا را فقط مالک یا دارندهٔ بستهٔ فعال می‌بیند (NEED_PACKAGE).
 */
@ApiTags('buyerBook')
/** حد نرخ ریزتر از سراسری — ذخیره/ویرایش مکرر */
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('buyerBook')
export class BuyerBookController {
  constructor(private readonly books: BuyerBookService) {}

  // ─── شخصی‌سازی (پنل خریدار → مودال تنظیمات دفتر خرید) ─────────────────

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMySettings')
  @ApiOperation({ summary: 'تنظیمات دفتر خودم — با آیدی تصادفی پیش‌فرض، همیشه پر' })
  async getMySettings(@CurrentUser() user: AuthUser) {
    return ok(await this.books.getMySettings(user.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('updateSettings')
  @ApiOperation({ summary: 'ذخیرهٔ تنظیمات — فقط فیلدهای ارسالی؛ آیدی تکراری 409' })
  async updateSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdateBookSettingsDto) {
    return ok(await this.books.updateSettings(user.id, dto));
  }

  // ─── صفحهٔ عمومی /b/{id} ───────────────────────────────────────────────

  @Post('resolvePublicId')
  @ApiOperation({ summary: 'رزولو آیدی عمومی — سفارشی یا userName؛ null = 404 فرانت' })
  async resolvePublicId(@Body() dto: ResolveBookIdDto) {
    return ok(await this.books.resolvePublicId(dto.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getPublic')
  @ApiOperation({
    summary: 'دیتای کامل دفتر — گیت: مالک یا دارندهٔ بستهٔ فعال (وگرنه 403 NEED_PACKAGE)',
  })
  async getPublic(@CurrentUser() user: AuthUser, @Body() dto: ResolveBookIdDto) {
    return ok(await this.books.getPublic(user.id, dto.id));
  }

  // ─── دفترچهٔ ذخیرهٔ فروشنده (لیست مشتری بالقوه) ────────────────────────

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('isSaved')
  @ApiOperation({ summary: 'وضعیت دکمهٔ ذخیره — آیا این دفتر خرید را ذخیره کرده‌ام؟' })
  async isSaved(@CurrentUser() user: AuthUser, @Body() dto: BuyerUserNameDto) {
    return ok(await this.books.isSaved(user.id, dto.userName));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('toggleSave')
  @ApiOperation({ summary: 'ذخیره/حذف ذخیرهٔ دفتر خرید — تب «دفاتر ذخیره شده» پنل فروشنده' })
  async toggleSave(@CurrentUser() user: AuthUser, @Body() dto: BuyerUserNameDto) {
    return ok(await this.books.toggleSave(user.id, dto.userName));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMySaved')
  @ApiOperation({ summary: 'دفاتر خرید ذخیره‌شدهٔ من — لیست مشتری بالقوه' })
  async getMySaved(@CurrentUser() user: AuthUser) {
    return ok(await this.books.getMySaved(user.id));
  }
}
