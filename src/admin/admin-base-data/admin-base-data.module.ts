import { Module } from '@nestjs/common';
import { AdminBaseDataController } from './admin-base-data.controller';
import { AdminBaseDataService } from './admin-base-data.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

/**
 * فاز A2 — مدیریت اطلاعات پایه پنل ادمین (دسته‌بندی‌ها + مکان‌ها).
 * کش تگ‌دار (base/categories/locations/products) پس از هر نوشتن ابطال می‌شود
 * تا لیست‌های عمومی بلافاصله تازه شوند.
 */
@Module({
  imports: [AdminAuthModule], // گارد ادمین
  controllers: [AdminBaseDataController],
  providers: [AdminBaseDataService],
})
export class AdminBaseDataModule {}
