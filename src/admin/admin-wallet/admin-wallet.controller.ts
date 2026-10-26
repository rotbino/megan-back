import { Body, Controller, Post, UseGuards, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminId } from '../admin-auth/admin-auth.controller';
import { AdminWalletService } from './admin-wallet.service';
import { ok } from '../../common/api-response';
import { GetAdminChargeOrdersDto, ReviewAdminChargeOrderDto } from './dto';

/** نام کاربری ادمین از توکن — برای ثبت بررسی‌کننده شارژ در سابقه */
export const AdminUsername = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ adminUsername?: string }>();
    return request.adminUsername ?? '';
  },
);

/**
 * فاز A5 — صف شارژهای کارت‌به‌کارت (admin/wallet/*).
 * منبع واحد بازبینی شارژ (مسیر قدیمی wallet/* ادمینِ توکن‌کاربر حذف شد).
 */
@ApiTags('admin-wallet')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/wallet')
export class AdminWalletController {
  constructor(private readonly wallet: AdminWalletService) {}

  @Post('getChargeOrders')
  @ApiOperation({ summary: 'صف بررسی فیش‌های شارژ — فیلتر وضعیت + صفحه‌بندی' })
  async getChargeOrders(@Body() dto: GetAdminChargeOrdersDto) {
    return ok(await this.wallet.getChargeOrders(dto));
  }

  @Post('reviewChargeOrder')
  @ApiOperation({ summary: 'تأیید (شارژ اعمال می‌شود) یا رد با دلیل' })
  async reviewChargeOrder(
    @AdminId() adminId: string,
    @AdminUsername() adminUsername: string,
    @Body() dto: ReviewAdminChargeOrderDto,
  ) {
    return ok(
      await this.wallet.reviewChargeOrder(adminId, adminUsername, dto),
      dto.approve ? 'شارژ کیف پول کاربر تأیید و اعمال شد.' : 'سفارش شارژ رد شد.',
    );
  }
}
