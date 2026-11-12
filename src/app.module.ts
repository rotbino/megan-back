import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { HealthController } from './health.controller';
import { SecurityModule } from './security/security.module';
import { SecurityGuard } from './security/security.guard';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { LocationsModule } from './locations/locations.module';
import { UploadsModule } from './uploads/uploads.module';
import { ProductsModule } from './products/products.module';
import { CityMarketModule } from './city-market/city-market.module';
import { VerificationModule } from './verification/verification.module';
import { BuyRequestsModule } from './buy-requests/buy-requests.module';
import { FollowModule } from './follow/follow.module';
import { ChatModule } from './chat/chat.module';
import { PresenceModule } from './presence/presence.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SurveyModule } from './survey/survey.module';
import { SupportModule } from './support/support.module';
import { CallsModule } from './calls/calls.module';
import { WalletModule } from './wallet/wallet.module';
import { PackagesModule } from './packages/packages.module';
import { SiteSettingsModule } from './site-settings/site-settings.module';
import { BuyersModule } from './buyers/buyers.module';
import { PushModule } from './push/push.module';
import { ActivityModule } from './activity/activity.module';
import { FavoritesModule } from './favorites/favorites.module';
import { ContactsModule } from './contacts/contacts.module';
import { CatalogModule } from './catalog/catalog.module';
import { BuyerBookModule } from './buyer-book/buyer-book.module';
import { TasksModule } from './tasks/tasks.module';
import { ServiceSignupsModule } from './service-signups/service-signups.module';
import { ImporterModule } from './importer/importer.module';
import { AdminModule } from './admin/admin.module';

/**
 * ریشه API مگان — فقط ماژول‌های ویژگی؛ زیرساخت مشترک در CommonModule
 * (Prisma + کش). حد نرخ سراسری: ۳۰۰ درخواست/دقیقه/IP (کنترلر auth سخت‌تر).
 * SecurityGuard: بلاک‌لیست IPهای سوءاستفاده‌گر (امنیت شماره‌ها ۱-۱۱).
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    CommonModule,
    SecurityModule, // امنیت داده‌های تماس — بلاک خودکار کاربر/IP سوءاستفاده‌گر
    AuthModule,
    UsersModule,
    CategoriesModule,
    LocationsModule,
    UploadsModule,
    ProductsModule,
    CityMarketModule, // بازار عمدهٔ شهری — اندپوینت مستقل چندشهری (۹-۱۱)
    VerificationModule,
    BuyRequestsModule,
    FollowModule, // پیگیری‌ها — CRM کوچک (جایگزین نشان‌شده‌های باسکول)
    ChatModule,
    PresenceModule,
    ReviewsModule,
    SurveyModule,
    SupportModule, // گفتگوی پشتیبانی کاربر ↔ پشتیبان (پاسخ‌دهی: admin/support)
    CallsModule,
    WalletModule,
    PackagesModule, // بسته‌های اشتراک — خرید کارت‌به‌کارت + گیت‌ها
    SiteSettingsModule, // تنظیمات پویای صورتحساب — Global (سند واحد SiteSetting)
    BuyersModule, // خریداران — دفتر خرید + دایرکتوری + پیشنهاد تامین (۳۱-۱۰)
    PushModule,
    ActivityModule, // فعالیت کاربران — جستجو/دسته/صفحه (۳۰-۱۰)
    FavoritesModule, // علاقه‌مندی‌ها — آگهی + فروشنده (۳۰-۱۰)
    ContactsModule, // مخاطبین گوشی — «ارسال به مخاطبین» (۴-۱۱)
    CatalogModule, // کاتالوگ محصول — صفحهٔ عمومی مستقل فروشنده (۱۰-۱۱)
    BuyerBookModule, // دفتر خرید — صفحهٔ عمومی خریدار /b/{bookId} + ذخیرهٔ فروشنده‌ها (۱۰-۱۱ دور ۵)
    TasksModule, // تسک‌های کاربر — کارهای مهم مانده برای زنگولهٔ اعلان (۱۱-۱۱ دور ۴)
    ServiceSignupsModule, // ثبت‌نام سرویس‌های تخصصی — ریتو/همخرید از /services (۱۱-۱۲)
    ImporterModule, // ایمپورتر باسکول — ابزار داخلی ادمین /api/v1/importer (۱۳-۱۱)
    AdminModule, // پنل ادمین — کد کاملاً جدا در src/admin/
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SecurityGuard },
  ],
})
export class AppModule {}
