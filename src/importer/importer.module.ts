import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { ImporterController } from './importer.controller';
import { ImporterService } from './importer.service';

/**
 * ایمپورتر باسکول — ابزار داخلی ادمین (بازسازی ۱۳-۱۱).
 * PrismaModule گلوبال است. عکس‌ها از طریق UploadsService وارد می‌شوند تا
 * «دقیقاً همان مسیر/پردازش/واترمارک آپلود عادی کاربر» را بگیرند
 * (users/{userId}/… — خواستهٔ مالک ۱۳-۱۱)؛ درایور پاک‌سازی درون سرویس
 * از buildStorage ساخته می‌شود.
 */
@Module({
  imports: [UploadsModule],
  controllers: [ImporterController],
  providers: [ImporterService],
  exports: [ImporterService],
})
export class ImporterModule {}
