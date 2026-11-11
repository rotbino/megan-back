import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { ok } from '../../common/api-response';
import { AdminServiceSignupsService } from './admin-service-signups.service';
import { GetSignupListDto } from './dto';

/** ثبت‌نام سرویس‌های تخصصی — خواندن از پنل ادمین (فهرست + آمار تفکیکی). */
@ApiTags('admin/service-signups')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Controller('admin/service-signups')
export class AdminServiceSignupsController {
  constructor(private readonly signups: AdminServiceSignupsService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('getSignupList')
  @ApiOperation({ summary: 'ثبت‌نام‌های ریتو/همخرید — چه کسانی، چه صنعفی، چه کسب‌وکاری' })
  async getSignupList(@Body() dto: GetSignupListDto) {
    return ok(await this.signups.getSignupList(dto));
  }
}
