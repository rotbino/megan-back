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
 * سرویس صادر می‌شود تا CatalogV2Module (اندپوینت عمومی /product-filter)
 * همان منطق را با شکل عمومی (فقط confirmed، بدون تلفن) بازاستفاده کند.
 */
@Module({
  imports: [AdminAuthModule, CategoriesModule, LocationsModule, UploadsModule],
  controllers: [AdsReportController],
  providers: [AdsReportService],
  exports: [AdsReportService],
})
export class AdsReportModule {}
