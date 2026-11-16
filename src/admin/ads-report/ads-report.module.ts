import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { CategoriesModule } from '../../categories/categories.module';
import { LocationsModule } from '../../locations/locations.module';
import { UploadsModule } from '../../uploads/uploads.module';
import { AdsReportController } from './ads-report.controller';
import { AdsReportService } from './ads-report.service';

/**
 * گزارش آگهی‌ها (تاکسونومی v2) — فقط خواندنی؛ هیچ state ی تغییر نمی‌دهد.
 * جدول نگاشت در کد است (buskol-map.generated.ts) پس این ماژول به هیچ
 * مهاجرت دیتابیس نیاز ندارد — با همان دیتای فعلی کار می‌کند.
 */
@Module({
  imports: [AdminAuthModule, CategoriesModule, LocationsModule, UploadsModule],
  controllers: [AdsReportController],
  providers: [AdsReportService],
})
export class AdsReportModule {}
