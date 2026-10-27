import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { AdminDashboardModule } from './admin-dashboard/admin-dashboard.module';
import { AdminBaseDataModule } from './admin-base-data/admin-base-data.module';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { AdminProductsModule } from './admin-products/admin-products.module';
import { AdminBuyRequestsModule } from './admin-buy-requests/admin-buy-requests.module';
import { AdminActionsModule } from './admin-actions/admin-actions.module';
import { AdminActionInterceptor } from './admin-actions/admin-action.interceptor';
import { AdminWalletModule } from './admin-wallet/admin-wallet.module';
import { AdminAdminsModule } from './admin-admins/admin-admins.module';
import { AdminUploadsModule } from './admin-uploads/admin-uploads.module';
import { AdminChatsModule } from './admin-chats/admin-chats.module';

/**
 * ریشه پنل ادمین — تمام کد ادمین بک‌اند فقط در همین فولدر زندگی می‌کند
 * (docs/ADMIN-IMPLEMENTATION.md — اصول طلایی §۰.۱).
 *
 * APP_INTERCEPTOR: AdminActionInterceptor سراسری رجیستر می‌شود — هر
 * mutation موفق ادمین (درخواست‌هایی که AdminJwtAuthGuard تزئینشان کرده)
 * خودکار در AdminAction لاگ می‌شود (فاز A5).
 */
@Module({
  imports: [
    AdminAuthModule,
    AdminDashboardModule,
    AdminBaseDataModule,
    AdminUsersModule,
    AdminProductsModule,
    AdminBuyRequestsModule,
    AdminActionsModule,
    AdminWalletModule,
    AdminAdminsModule,
    AdminUploadsModule,
    AdminChatsModule,
  ],
  providers: [
    // ثبت خودکار لاگ عملیات ادمین — سراسری ولی فقط برای درخواست‌های ادمین
    { provide: APP_INTERCEPTOR, useClass: AdminActionInterceptor },
  ],
})
export class AdminModule {}
