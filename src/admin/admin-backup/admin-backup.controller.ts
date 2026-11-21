import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { ok } from '../../common/api-response';
import { AdminBackupService } from './admin-backup.service';
import { BackupJobDto, BackupTransferDto } from './dto';

/**
 * بک‌آپ دیتابیس (تسک ۳۳ — ۲۱-۱۱) — صفحهٔ «بک‌آپ دیتابیس» در بخش دیتا ایمپورت.
 * کپی کامل دیتابیس‌های Atlas به مونگوی لوکالِ ماشینِ اجرای بک‌اند.
 *
 * نام‌گذاری اندپوینت‌ها عمداً با «get» شروع می‌شود تا AdminActionInterceptor
 * آن‌ها را mutation نبیند و روی Atlas ننویسد (خواندن است)؛ فقط transfer
 * در لاگ عملیات ثبت می‌شود.
 */
@ApiTags('admin-backup')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('admin/backup')
export class AdminBackupController {
  constructor(private readonly backup: AdminBackupService) {}

  @Post('getInfo')
  @ApiOperation({ summary: 'دیتابیس‌های سرور ابری و لوکال + وضعیت اتصال هر دو' })
  async getInfo() {
    return ok(await this.backup.getInfo());
  }

  @Post('transfer')
  @ApiOperation({ summary: 'انتقال کامل یک دیتابیس ابری به دیتابیس هم‌نام در مونگوی لوکال (کپی دقیق + ایندکس‌ها)' })
  async transfer(@Body() dto: BackupTransferDto) {
    return ok(await this.backup.startTransfer(dto));
  }

  @Post('getJob')
  @ApiOperation({ summary: 'وضعیت لحظه‌ای جاب انتقال — پیشرفت کالکشن‌به‌کالکشن' })
  async getJob(@Body() dto: BackupJobDto) {
    return ok(await this.backup.getJob(dto.jobId));
  }
}
