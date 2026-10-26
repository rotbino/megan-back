import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { WalletService } from './wallet.service';
import { GetChargeOrdersDto, LadderProductDto, ReviewChargeOrderDto } from './dto';
import { AdminGuard, JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';

@ApiTags('wallet')
/** حد نرخ ریزتر از سراسری — مالی — حساس */
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getWallet')
  @ApiOperation({ summary: 'موجودی کیف پول + کارت واریز + پکیج‌های شارژ + قیمت نردبان' })
  async getWallet(@CurrentUser() user: AuthUser) {
    return ok(await this.wallet.getWallet(user.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getWalletTransactions')
  @ApiOperation({ summary: 'تاریخچه تراکنش‌ها — شارژها + کسر نردبان‌ها' })
  async getWalletTransactions(@CurrentUser() user: AuthUser) {
    return ok(await this.wallet.getWalletTransactions(user.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('createChargeOrder')
  @ApiOperation({
    summary: 'ارسال فیش شارژ کارت‌به‌کارت (multipart: packageKey + receipt) → در انتظار تایید ادمین',
  })
  async createChargeOrder(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest) {
    return ok(
      await this.wallet.createChargeOrder(user, req),
      'فیش شما با موفقیت ارسال شد؛ پس از بررسی و تایید ادمین، شارژ به کیف پول شما اعمال می‌شود.',
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('ladderProduct')
  @ApiOperation({ summary: 'نردبان آگهی برای یک ماه — ۱۰۰هزار تومان از کیف پول' })
  async ladderProduct(@CurrentUser() user: AuthUser, @Body() dto: LadderProductDto) {
    return ok(
      await this.wallet.ladderProduct(user, dto),
      'نردبان آگهی شما برای یک ماه فعال شد و هزینه آن از کیف پولتان کسر شد.',
    );
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @Post('getChargeOrders')
  @ApiOperation({ summary: '(ادمین) صف بررسی فیش‌های شارژ کارت‌به‌کارت' })
  async getChargeOrders(@Body() dto: GetChargeOrdersDto) {
    return ok(await this.wallet.getChargeOrders(dto));
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @Post('reviewChargeOrder')
  @ApiOperation({ summary: '(ادمین) تأیید (شارژ اعمال می‌شود) یا رد با دلیل' })
  async reviewChargeOrder(@CurrentUser() user: AuthUser, @Body() dto: ReviewChargeOrderDto) {
    return ok(
      await this.wallet.reviewChargeOrder(user, dto),
      dto.approve
        ? 'شارژ کیف پول کاربر تأیید و اعمال شد.'
        : 'سفارش شارژ رد شد.',
    );
  }
}
