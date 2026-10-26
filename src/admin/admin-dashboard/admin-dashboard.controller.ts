import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminDashboardService } from './admin-dashboard.service';
import { ok } from '../../common/api-response';

@ApiTags('admin-dashboard')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Post('getStats')
  @ApiOperation({ summary: 'شمارنده‌ها + روند ۳۰ روزه + درآمد + صف‌های انتظار' })
  async getStats() {
    return ok(await this.dashboard.getStats());
  }

  @Post('getRecentActivity')
  @ApiOperation({ summary: 'آخرین عملیات ادمین‌ها + آخرین ثبت‌نام‌ها (فید داشبورد)' })
  async getRecentActivity() {
    return ok(await this.dashboard.getRecentActivity());
  }
}
