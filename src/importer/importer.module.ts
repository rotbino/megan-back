import { Module } from '@nestjs/common';
import { ImporterController } from './importer.controller';
import { ImporterService } from './importer.service';

/**
 * ایمپورتر باسکول — ابزار داخلی ادمین (بازسازی ۱۳-۱۱).
 * PrismaModule گلوبال است؛ StorageDriver درون سرویس از buildStorage ساخته می‌شود.
 */
@Module({
  controllers: [ImporterController],
  providers: [ImporterService],
  exports: [ImporterService],
})
export class ImporterModule {}
