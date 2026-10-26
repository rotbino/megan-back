import { Module } from '@nestjs/common';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { AdminDashboardModule } from './admin-dashboard/admin-dashboard.module';
import { AdminBaseDataModule } from './admin-base-data/admin-base-data.module';

/**
 * ریشه پنل ادمین — تمام کد ادمین بک‌اند فقط در همین فولدر زندگی می‌کند
 * (docs/ADMIN-IMPLEMENTATION.md — اصول طلایی §۰.۱). زیرماژول‌های بعدی:
 * admin-users (A3)، admin-products/admin-buy-requests (A4) — هر کدام
 * ساختار تخت module/controller/service/dto.
 */
@Module({
  imports: [AdminAuthModule, AdminDashboardModule, AdminBaseDataModule],
})
export class AdminModule {}
