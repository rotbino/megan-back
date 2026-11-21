import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../common/api-response';
import { AdminJwtAuthGuard } from '../admin/admin-auth/admin-jwt.guard';
import { DaymatService } from './daymat.service';
import { MigrateBDto } from './dto';

/**
 * مهاجرت دیمت → ایمچ (تسک ۳۵ — ۲۱-۱۱) — کاربران/کالاها/تصاویر دیمت به
 * ایمچ؛ پشت توکن ادمین. اجرا (run) به‌علاوه با IMPORTER_ADMIN_PHONE گارد
 * می‌شود مثل سایر عملیات مخرب ایمپورتر. GET فقط توکن می‌خواهد تا پیشرفت
 * از تب دیگر هم دیده شود.
 */
@ApiTags('importer')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@UseGuards(AdminJwtAuthGuard)
@Controller('importer/daymat')
export class DaymatController {
  constructor(private readonly daymat: DaymatService) {}

  @Post('status')
  @ApiOperation({ summary: 'پیش‌نمایش مهاجرت دیمت — شمارش بدون هیچ نوشتنی' })
  async status() {
    return ok(await this.daymat.status());
  }

  @Post('run')
  @ApiOperation({ summary: 'شروع مهاجرت دیمت — جاب تکی پس‌زمینه با پیشرفت زنده (idempotent)' })
  async run(@Body() dto: MigrateBDto) {
    return ok(await this.daymat.run(dto.adminPhone));
  }

  @Get('job')
  @ApiOperation({ summary: 'پیشرفت لحظه‌ای جاب مهاجرت دیمت' })
  async job() {
    return ok({ busy: this.daymat.busy, job: this.daymat.progress() });
  }
}
