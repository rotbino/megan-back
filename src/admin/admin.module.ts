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
import { AdminPackagesModule } from './admin-packages/admin-packages.module';
import { AdminAdminsModule } from './admin-admins/admin-admins.module';
import { AdminUploadsModule } from './admin-uploads/admin-uploads.module';
import { AdminChatsModule } from './admin-chats/admin-chats.module';
import { AdminMessagesModule } from './admin-messages/admin-messages.module';
import { AdminCallsModule } from './admin-calls/admin-calls.module';
import { AdminSurveysModule } from './admin-surveys/admin-surveys.module';
import { AdminReviewsModule } from './admin-reviews/admin-reviews.module';
import { AdminActivitiesModule } from './admin-activities/admin-activities.module';

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
    AdminPackagesModule, // صف بازبینی فیش‌های خرید بسته اشتراک
    AdminAdminsModule,
    AdminUploadsModule,
    AdminChatsModule,
    AdminCallsModule,
    AdminMessagesModule,
    AdminSurveysModule,
    AdminReviewsModule,
    AdminActivitiesModule, // فعالیت کاربران — جستجو/دسته/صفحه
  ],
  providers: [
    // ثبت خودکار لاگ عملیات ادمین — سراسری ولی فقط برای درخواست‌های ادمین
    { provide: APP_INTERCEPTOR, useClass: AdminActionInterceptor },
  ],
})
export class AdminModule {}
