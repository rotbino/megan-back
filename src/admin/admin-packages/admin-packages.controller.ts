import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminId } from '../admin-auth/admin-auth.controller';
import { AdminUsername } from '../admin-wallet/admin-wallet.controller';
import { AdminPackagesService } from './admin-packages.service';
import { ok } from '../../common/api-response';
import { GetAdminPackageOrdersDto, ReviewAdminPackageOrderDto } from './dto';

/** صف بررسی فیش‌های خرید بسته اشتراک — منبع واحد (admin/packages/*) */
@ApiTags('admin-packages')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/packages')
export class AdminPackagesController {
  constructor(private readonly packages: AdminPackagesService) {}

  @Post('getPackageOrders')
  @ApiOperation({ summary: 'صف بررسی فیش‌های بسته — فیلتر وضعیت + صفحه‌بندی' })
  async getPackageOrders(@Body() dto: GetAdminPackageOrdersDto) {
    return ok(await this.packages.getPackageOrders(dto));
  }

  @Post('reviewPackageOrder')
  @ApiOperation({ summary: 'تأیید (بسته فعال/تمدید می‌شود) یا رد با دلیل' })
  async reviewPackageOrder(
    @AdminId() adminId: string,
    @AdminUsername() adminUsername: string,
    @Body() dto: ReviewAdminPackageOrderDto,
  ) {
    return ok(
      await this.packages.reviewPackageOrder(adminId, adminUsername, dto),
      dto.approve ? 'بسته اشتراک کاربر تأیید و فعال شد.' : 'سفارش بسته رد شد.',
    );
  }
}
