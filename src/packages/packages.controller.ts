import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { PackagesService } from './packages.service';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';

@ApiTags('packages')
/** حد نرخ ریزتر از سراسری — مالی — حساس */
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('packages')
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Post('getPlans')
  @ApiOperation({ summary: 'پلن‌های اشتراک + امکانات بسته رایگان + کارت واریز (عمومی)' })
  async getPlans() {
    return ok(this.packages.getPlans());
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMyPackage')
  @ApiOperation({ summary: 'بسته فعال من + امکانات مؤثر (ظرفیت محصول، دسترسی خریداران)' })
  async getMyPackage(@CurrentUser() user: AuthUser) {
    return ok(await this.packages.getMyPackage(user.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('createPackageOrder')
  @ApiOperation({
    summary: 'ارسال فیش خرید بسته (multipart: planKey + receipt) → در انتظار تایید ادمین',
  })
  async createPackageOrder(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest) {
    return ok(
      await this.packages.createPackageOrder(user, req),
      'فیش شما با موفقیت ارسال شد؛ پس از بررسی و تایید ادمین، بسته روی حساب شما فعال می‌شود.',
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMyPackageOrders')
  @ApiOperation({ summary: 'سفارش‌های بسته خودم — در انتظار/تایید/رد + دلیل رد + فیش' })
  async getMyPackageOrders(@CurrentUser() user: AuthUser) {
    return ok(await this.packages.getMyPackageOrders(user.id));
  }

  // صف و بازبینی بسته‌ها فقط از مسیر ادمین:
  // POST /admin/packages/getPackageOrders|reviewPackageOrder (AdminJwtAuthGuard)
}
