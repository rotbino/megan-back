import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BuyersService } from './buyers.service';
import {
  GetBuyerDirectoryDto,
  GroupSendSupplyOfferDto,
  SaveMyBookDto,
  SendSupplyOfferDto,
} from './dto';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../common/guards';
import {
  CurrentUser,
  MaybeCurrentUser,
} from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';

@ApiTags('buyers')
@Throttle({ default: { limit: 90, ttl: 60_000 } })
@Controller('buyers')
export class BuyersController {
  constructor(private readonly buyers: BuyersService) {}

  // ─── دفتر خرید من ──────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMyBook')
  @ApiOperation({ summary: 'دفتر خرید من — دسته‌های برگ + بازه حجم خرید ماهانه' })
  async getMyBook(@CurrentUser() user: AuthUser) {
    return ok(await this.buyers.getMyBook(user.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('saveMyBook')
  @ApiOperation({ summary: 'جایگزینی کامل دفتر خرید من (حداکثر ۱۵ دسته)' })
  async saveMyBook(@CurrentUser() user: AuthUser, @Body() dto: SaveMyBookDto) {
    return ok(
      await this.buyers.saveMyBook(user.id, dto),
      'دفتر خرید شما ذخیره شد — از این پس در فهرست خریداران دیده می‌شوید.',
    );
  }

  // ─── دایرکتوری عمومی ────────────────────────────────────────────────────────

  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @Post('directory')
  @ApiOperation({
    summary:
      'فهرست خریداران — فیلتر دسته/استان/شهر + صفحه‌بندی؛ اگر توکن باشد کارت‌های خود بیننده حذف می‌شود',
  })
  async directory(@MaybeCurrentUser() viewer: AuthUser | null, @Body() dto: GetBuyerDirectoryDto) {
    return ok(await this.buyers.directory(dto, viewer?.id ?? null));
  }

  // ─── پیشنهاد تامین ─────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMyOfferQuota')
  @ApiOperation({ summary: 'سهمیه پیشنهاد تامین امروز + قیمت ارسال گروهی (دارندگان بسته)' })
  async getMyOfferQuota(@CurrentUser() user: AuthUser) {
    return ok(await this.buyers.myQuota(user));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('sendSupplyOffer')
  @ApiOperation({ summary: 'پیشنهاد تامین تکی — رایگان تا سقف روزانه سطح بسته' })
  async sendSupplyOffer(@CurrentUser() user: AuthUser, @Body() dto: SendSupplyOfferDto) {
    return ok(
      await this.buyers.sendSupplyOffer(user, dto),
      'پیشنهاد تامین برای خریدار ارسال شد — پاسخ را در «پیام ها» دنبال کنید.',
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('groupSendSupplyOffer')
  @ApiOperation({ summary: 'ارسال گروهی پیشنهاد تامین — پولی از کیف پول (هر گیرنده)' })
  async groupSendSupplyOffer(@CurrentUser() user: AuthUser, @Body() dto: GroupSendSupplyOfferDto) {
    return ok(
      await this.buyers.groupSendSupplyOffer(user, dto),
      'ارسال گروهی انجام شد — هزینه از کیف پول شما کسر شد.',
    );
  }
}
