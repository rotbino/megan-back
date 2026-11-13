import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../common/api-response';
import { ImporterService } from './importer.service';
import { ImportedUsersService } from './imported-users.service';
import {
  CleanupDto,
  ListImportDto,
  MigrateBDto,
  SingleImportDto,
  StopJobDto,
} from './dto';

/**
 * ایمپورتر باسکول — ابزار داخلی ادمین برای مهاجرت داده از buskool.com.
 * مسیر عمومی: /api/v1/importer/* (پشت CORS_ORIGINS اپ؛ عملیات مخرب فقط
 * با adminPhone مطابق IMPORTER_ADMIN_PHONE).
 */
@ApiTags('importer')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('importer')
export class ImporterController {
  constructor(
    private readonly importer: ImporterService,
    private readonly importedUsers: ImportedUsersService,
  ) {}

  @Get('ping')
  @ApiOperation({ summary: 'وضعیت ایمپورتر — اتصال، تاخیر باسکول، کوکی، مشغولی' })
  ping() {
    return ok(this.importer.ping());
  }

  @Get('stats')
  @ApiOperation({ summary: 'آمار فعلی دیتابیس ایمچ' })
  async stats() {
    return ok(await this.importer.stats());
  }

  @Get('source-info')
  @ApiOperation({ summary: 'وضعیت کالکشن منبع user-buskool (همان دیتابیس ایمچ)' })
  async sourceInfo() {
    return ok(await this.importer.sourceInfo());
  }

  @Get('next-unimported')
  @ApiOperation({ summary: 'اولین کاربر منبع که هنوز ایمپورت نشده — پرکردن offset ادامه' })
  async nextUnimported() {
    return ok(await this.importer.nextUnimported());
  }

  @Post('cleanup')
  @ApiOperation({ summary: 'پاک‌سازی کامل دیتابیس — فقط حساب ادمین می‌ماند (خطرناک)' })
  async cleanup(@Body() dto: CleanupDto) {
    return ok(await this.importer.cleanup(dto.adminPhone));
  }

  @Post('migrate-b')
  @ApiOperation({
    summary:
      'مهاجرت رکوردهای قدیمی به ساختار b — فیلدهای b_* پراکنده → سند یکپارچه + صفر شدن activePakageType کپی‌شده از باسکول',
  })
  async migrateB(@Body() dto: MigrateBDto) {
    return ok(await this.importedUsers.migrateB(dto.adminPhone));
  }

  @Post('single')
  @ApiOperation({ summary: 'شروع ایمپورت تک‌کاربره — پروفایل، آگهی‌ها، عکس‌ها، کامنت‌ها' })
  startSingle(@Body() dto: SingleImportDto) {
    return ok(this.importer.startSingle(dto));
  }

  @Post('list')
  @ApiOperation({ summary: 'شروع ایمپورت لیستی از کالکشن user-buskool — رد شدن از ایمپورت‌شده‌ها' })
  startList(@Body() dto: ListImportDto) {
    return ok(this.importer.startList(dto));
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'وضعیت جاب — steps/log/counters زنده' })
  getJob(@Param('id') id: string) {
    const job = this.importer.getJob(id);
    if (!job) return ok(null, 'چنین جابی وجود ندارد');
    return ok(job);
  }

  @Post('jobs/:id/stop')
  @ApiOperation({ summary: 'توقف جاب در حال اجرا' })
  stopJob(@Param('id') id: string, @Body() dto: StopJobDto) {
    return ok(this.importer.stopJob(id, dto.adminPhone));
  }

  @Get('preview/:userName')
  @ApiOperation({ summary: 'پیش‌نمایش دادهٔ ایمپورت‌شدهٔ یک کاربر در دیتابیس ایمچ' })
  async preview(@Param('userName') userName: string) {
    return ok(await this.importer.preview(userName));
  }
}
