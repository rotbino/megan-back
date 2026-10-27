import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminUploadsService } from './admin-uploads.service';
import { ok } from '../../common/api-response';
import { DeleteOrphansAdminDto, UsageAdminDto } from './dto';

/**
 * فاز A5 — نگهداشت فایل ادمین (admin/uploads/*).
 * عملیات حساس حذف — فقط پنل ادمین با AdminJwtAuthGuard.
 */
@ApiTags('admin-uploads')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('admin/uploads')
export class AdminUploadsController {
  constructor(private readonly uploads: AdminUploadsService) {}

  @Post('listOrphans')
  @ApiOperation({ summary: 'فایل‌های عروسک (staged منقضی + dangling)' })
  async listOrphans() {
    return ok(await this.uploads.listOrphans());
  }

  @Post('deleteOrphans')
  @ApiOperation({ summary: 'حذف عروسک‌ها (با ids یا همه) — عملیات حساس' })
  async deleteOrphans(@Body() dto: DeleteOrphansAdminDto) {
    return ok(await this.uploads.deleteOrphans(dto), 'عروسک‌ها حذف شدند.');
  }

  @Post('getUsage')
  @ApiOperation({ summary: 'مصرف ذخیره‌سازی هر کاربر' })
  async getUsage(@Body() dto: UsageAdminDto) {
    return ok(await this.uploads.getUsage(dto));
  }
}
