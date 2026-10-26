import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BuyRequestsService } from './buy-requests.service';
import {
  CreateBuyRequestDto,
  DeleteMyBuyRequestDto,
  GetBuyRequestContactDto,
  GetBuyRequestListDto,
  GetMyBuyRequestsDto,
  ReviewBuyRequestDto,
} from './dto';
import { AdminGuard, JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';

@ApiTags('buy-requests')
/** حد نرخ ریزتر از سراسری — خواندن لیست/جستجو سبک + ثبت درخواست */
@Throttle({ default: { limit: 90, ttl: 60_000 } })
@Controller('buy-requests')
export class BuyRequestsController {
  constructor(private readonly buyRequests: BuyRequestsService) {}

  @Post('getBuyRequestList')
  @ApiOperation({ summary: 'لیست عمومی درخواست‌های خرید تاییدشده (صفحه buyAd-requests)' })
  async getBuyRequestList(@Body() dto: GetBuyRequestListDto) {
    return ok(await this.buyRequests.getBuyRequestList(dto));
  }

  @Post('getLatestBuyRequests')
  @ApiOperation({ summary: 'جدیدترین درخواست‌های خرید — سکشن صفحه اول' })
  async getLatestBuyRequests() {
    return ok(await this.buyRequests.getLatestBuyRequests(4));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('createBuyRequest')
  @ApiOperation({ summary: 'ثبت درخواست خرید از ویزارد → «در انتظار تایید»' })
  async createBuyRequest(@CurrentUser() user: AuthUser, @Body() dto: CreateBuyRequestDto) {
    return ok(
      await this.buyRequests.createBuyRequest(user, dto),
      'درخواست خرید شما ثبت شد و پس از تایید نمایش داده می‌شود.',
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMyBuyRequests')
  @ApiOperation({ summary: 'درخواست‌های خرید کاربر جاری + شمارنده تب‌ها' })
  async getMyBuyRequests(@CurrentUser() user: AuthUser, @Body() dto: GetMyBuyRequestsDto) {
    return ok(await this.buyRequests.getMyBuyRequests(user.id, dto));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('deleteMyBuyRequest')
  @ApiOperation({ summary: 'حذف نرم درخواست خرید خودم' })
  async deleteMyBuyRequest(@CurrentUser() user: AuthUser, @Body() dto: DeleteMyBuyRequestDto) {
    return ok(await this.buyRequests.deleteMyBuyRequest(user, dto.id), 'درخواست حذف شد.');
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getBuyRequestContact')
  @ApiOperation({ summary: 'شماره تماس خریدار — نیازمند ورود (مدل Lead-gen باسکول)' })
  async getBuyRequestContact(@CurrentUser() user: AuthUser, @Body() dto: GetBuyRequestContactDto) {
    return ok(await this.buyRequests.getBuyRequestContact(user, dto.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getSuggestedBuyers')
  @ApiOperation({ summary: 'خریداران پیشنهادی — تطبیق درخواست‌ها با آگهی‌های من' })
  async getSuggestedBuyers(@CurrentUser() user: AuthUser) {
    return ok(await this.buyRequests.getSuggestedBuyers(user.id));
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @Post('reviewBuyRequest')
  @ApiOperation({ summary: '(ادمین) تأیید یا رد درخواست خرید' })
  async reviewBuyRequest(@Body() dto: ReviewBuyRequestDto) {
    return ok(
      await this.buyRequests.reviewBuyRequest(dto),
      dto.approve ? 'درخواست خرید تایید شد.' : 'درخواست رد شد.',
    );
  }
}
