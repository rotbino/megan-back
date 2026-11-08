import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminBuyerBookService } from './admin-buyer-book.service';
import { ok } from '../../common/api-response';
import { BookItemIdDto, GetAdminBookListDto, ReviewAdminBookItemDto } from './dto';

/**
 * مدیریت دفتر خرید — درخواست‌های خرید دوره‌ای (admin/buyer-book/*).
 * خواستهٔ مالک ۸-۱۱: کالاهای دفتر خرید هم مثل درخواست‌های فوری بازبینی
 * ادمین می‌خواهند؛ فقط POST JSON با قرارداد یکنواخت و گارد توکن ادمین.
 */
@ApiTags('admin-buyer-book')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/buyer-book')
export class AdminBuyerBookController {
  constructor(private readonly book: AdminBuyerBookService) {}

  @Post('getList')
  @ApiOperation({ summary: 'لیست کالاهای دفتر خرید خریداران — جستجو/فیلتر وضعیت + شمارنده تب‌ها' })
  async getList(@Body() dto: GetAdminBookListDto) {
    return ok(await this.book.getList(dto));
  }

  @Post('review')
  @ApiOperation({ summary: 'بازبینی کالای دفتر خرید — تأیید یا رد با دلیل' })
  async review(@Body() dto: ReviewAdminBookItemDto) {
    return ok(
      await this.book.review(dto),
      dto.approve ? 'کالای دفتر خرید تأیید شد.' : 'کالای دفتر خرید رد شد.',
    );
  }

  @Post('delete')
  @ApiOperation({ summary: 'حذف کالای دفتر خرید' })
  async delete(@Body() dto: BookItemIdDto) {
    return ok(await this.book.remove(dto.id), 'کالای دفتر خرید حذف شد.');
  }
}
