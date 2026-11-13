import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../common/api-response';
import { AdminJwtAuthGuard } from '../admin/admin-auth/admin-jwt.guard';
import { ImportedUsersService } from './imported-users.service';
import {
  DeleteUsersDto,
  ImportedUsersQueryDto,
  MarkContactDto,
  MigrateBDto,
} from './dto';

/**
 * مدیریت کاربران ایمپورت‌شده — پشت صفحهٔ «دیتا ایمپورت → مدیریت کاربران»
 * (بخش جدای ادمین؛ خواستهٔ مالک ۱۳-۱۱).
 *
 * همهٔ اندپوینت‌ها پشت AdminJwtAuthGuard (توکن ادمین، راز جدا) هستند؛
 * عملیات مخرب (حذف/مهاجرت) به‌علاوه با IMPORTER_ADMIN_PHONE گارد می‌شوند.
 */
@ApiTags('importer')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@UseGuards(AdminJwtAuthGuard)
@Controller('importer/users')
export class ImportedUsersController {
  constructor(private readonly users: ImportedUsersService) {}

  @Get()
  @ApiOperation({ summary: 'فهرست کاربران — فیلتر منبع/ویژگی باسکول/ورود/تماس + سورت + صفحه‌بندی + آمار' })
  async list(@Query() dto: ImportedUsersQueryDto) {
    return ok(await this.users.list(dto));
  }

  @Get('summary')
  @ApiOperation({ summary: 'آار کلی — کارت‌های بالای صفحهٔ مدیریت کاربران' })
  async summary() {
    return ok(await this.users.summary());
  }

  @Post('delete')
  @ApiOperation({ summary: 'حذف کامل کاربران انتخاب‌شده با همهٔ داده‌ها (خطرناک — فقط ادمین)' })
  async delete(@Body() dto: DeleteUsersDto) {
    return ok(await this.users.deleteUsers(dto.adminPhone, dto.ids));
  }

  @Get(':id')
  @ApiOperation({ summary: 'جزئیات کامل یک کاربر — پروفایل، سند b، آگهی‌ها، شمارنده‌ها' })
  async detail(@Param('id') id: string) {
    return ok(await this.users.detail(id));
  }

  @Post(':id/contact')
  @ApiOperation({ summary: 'علامت «تماس گرفتم و دعوتش کردم» — b.contactedAt (CRM)' })
  async markContacted(@Param('id') id: string, @Body() dto: MarkContactDto) {
    return ok(await this.users.markContacted(id, dto.undo === 'true'));
  }
}
