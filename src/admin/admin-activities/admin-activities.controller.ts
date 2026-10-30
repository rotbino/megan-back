import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { ActivityService } from '../../activity/activity.service';
import { AdminListActivitiesDto } from '../../activity/dto';
import { ok } from '../../common/api-response';

/** فهرست و آمار فعالیت کاربران — پنل ادمین (تب‌های صفحه فعالیت‌ها) */
@ApiTags('admin-activities')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/activities')
export class AdminActivitiesController {
  constructor(private readonly activity: ActivityService) {}

  @Post('list')
  @ApiOperation({ summary: 'فهرست فعالیت‌ها با فیلتر نوع/متن/کاربر + صفحه‌بندی' })
  async list(@Body() dto: AdminListActivitiesDto) {
    return ok(await this.activity.adminList(dto));
  }

  @Post('stats')
  @ApiOperation({ summary: 'شمارنده‌ها + پربازدیدهای جستجو/دسته/صفحه' })
  async stats() {
    return ok(await this.activity.adminStats());
  }
}
