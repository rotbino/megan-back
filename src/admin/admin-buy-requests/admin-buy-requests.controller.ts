import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminBuyRequestsService } from './admin-buy-requests.service';
import { ok } from '../../common/api-response';
import { BuyRequestIdDto, GetAdminBuyRequestListDto, ReviewAdminBuyRequestDto } from './dto';

/**
 * فاز A4 — مدیریت درخواست‌های خرید (admin/buy-requests/*).
 * فقط POST JSON با قرارداد یکنواخت؛ همه محافظت‌شده با AdminJwtAuthGuard
 * (توکن کاربر عادی اینجا هرگز قبول نمی‌شود — راز جدا + scope='admin').
 */
@ApiTags('admin-buy-requests')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/buy-requests')
export class AdminBuyRequestsController {
  constructor(private readonly buyRequests: AdminBuyRequestsService) {}

  @Post('getBuyRequestList')
  @ApiOperation({ summary: 'لیست درخواست‌های خرید — جستجو/فیلتر وضعیت-دسته-استان-خریدار + شمارنده تب‌ها' })
  async getBuyRequestList(@Body() dto: GetAdminBuyRequestListDto) {
    return ok(await this.buyRequests.getBuyRequestList(dto));
  }

  @Post('reviewBuyRequest')
  @ApiOperation({ summary: 'بازبینی درخواست در انتظار — تأیید یا رد با دلیل' })
  async reviewBuyRequest(@Body() dto: ReviewAdminBuyRequestDto) {
    return ok(
      await this.buyRequests.reviewBuyRequest(dto),
      dto.approve ? 'درخواست خرید تأیید شد.' : 'درخواست خرید رد شد.',
    );
  }

  @Post('deleteBuyRequest')
  @ApiOperation({ summary: 'حذف نرم درخواست (تب «حذف شده» کاربر)' })
  async deleteBuyRequest(@Body() dto: BuyRequestIdDto) {
    return ok(await this.buyRequests.deleteBuyRequest(dto.id), 'درخواست خرید حذف شد.');
  }
}
