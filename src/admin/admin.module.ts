import { Module } from '@nestjs/common';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { AdminDashboardModule } from './admin-dashboard/admin-dashboard.module';
import { AdminBaseDataModule } from './admin-base-data/admin-base-data.module';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { AdminProductsModule } from './admin-products/admin-products.module';
import { AdminBuyRequestsModule } from './admin-buy-requests/admin-buy-requests.module';

/**
 * ریشه پنل ادمین — تمام کد ادمین بک‌اند فقط در همین فولدر زندگی می‌کند
 * (docs/ADMIN-IMPLEMENTATION.md — اصول طلایی §۰.۱). زیرماژول بعدی:
 * admin A5 (داشبورد عملیاتی + لاگ + مدیریت ادمین‌ها).
 */
@Module({
  imports: [
    AdminAuthModule,
    AdminDashboardModule,
    AdminBaseDataModule,
    AdminUsersModule,
    AdminProductsModule,
    AdminBuyRequestsModule,
  ],
})
export class AdminModule {}
