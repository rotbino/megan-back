import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminCallsService } from './admin-calls.service';
import { GetCallReportDto } from './dto';
import { ok } from '../../common/api-response';

/**
 * گزارش تماس‌های کاربران — نمای ادمین (فقط خواندنی).
 * «کی به کی زنگ زده» — سنجه سلامت بازار lead-gen ایمچ.
 * همه اندپوینت‌ها get* هستند → در AdminAction به‌عنوان عملیات ثبت نمی‌شوند.
 */
@ApiTags('admin-calls')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 90, ttl: 60_000 } })
@Controller('admin/calls')
export class AdminCallsController {
  constructor(private readonly calls: AdminCallsService) {}

  @Post('getCallReport')
  @ApiOperation({ summary: 'لیست تماس‌ها (تازه‌ها بالا) + جستجو + بازه + آمار' })
  async getCallReport(@Body() dto: GetCallReportDto) {
    return ok(await this.calls.getCallReport(dto));
  }

  @Post('getCallStats')
  @ApiOperation({ summary: 'آمار تماس‌ها برای داشبورد' })
  async getCallStats() {
    return ok(await this.calls.getCallStats());
  }
}
