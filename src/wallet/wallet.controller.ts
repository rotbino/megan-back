import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { WalletService } from './wallet.service';
import { LadderProductDto } from './dto';
import { JwtAuthGuard } from '../common/guards';
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
  @ApiOperation({ summary: 'تراکنش‌های قطعی‌شده — شارژ کارت‌به‌کارت تأییدشده + نردبان + اصلاح ادمین' })
  async getWalletTransactions(@CurrentUser() user: AuthUser) {
    return ok(await this.wallet.getWalletTransactions(user.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMyChargeOrders')
  @ApiOperation({ summary: 'فیش‌های کارت‌به‌کارت خودم — در انتظار/تأیید/رد + دلیل رد (تب «کارت به کارت»)' })
  async getMyChargeOrders(@CurrentUser() user: AuthUser) {
    return ok(await this.wallet.getMyChargeOrders(user.id));
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
  @ApiOperation({ summary: 'نردبان آگهی ۱ تا ۴ ماه — ۵۰ هزار تومان در ماه از کیف پول' })
  async ladderProduct(@CurrentUser() user: AuthUser, @Body() dto: LadderProductDto) {
    const res = await this.wallet.ladderProduct(user, dto);
    const label = res.months === 1 ? 'یک ماه' : res.months === 2 ? 'دو ماه' : res.months === 3 ? 'سه ماه' : 'چهار ماه';
    return ok(
      res,
      `نردبان آگهی شما برای ${label} فعال شد و هزینه آن از کیف پولتان کسر شد.`,
    );
  }

  // صف و بازبینی شارژها حالا فقط از مسیر ادمین انجام می‌شود:
  // POST /admin/wallet/getChargeOrders|reviewChargeOrder (AdminJwtAuthGuard — فاز A5)
}
