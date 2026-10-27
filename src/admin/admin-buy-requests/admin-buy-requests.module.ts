import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { BuyRequestsModule } from '../../buy-requests/buy-requests.module';
import { CategoriesModule } from '../../categories/categories.module';
import { LocationsModule } from '../../locations/locations.module';
import { AdminBuyRequestsController } from './admin-buy-requests.controller';
import { AdminBuyRequestsService } from './admin-buy-requests.service';

/**
 * فاز A4 — مدیریت درخواست‌های خرید پنل ادمین.
 *
 * لیست/شمارنده تب‌ها با نام‌های join‌شده + بازبینی (منطق دامنه
 * BuyRequestsService — کپی نمی‌شود، اصل طلایی §۱) + حذف نرم.
 */
@Module({
  imports: [AdminAuthModule, BuyRequestsModule, CategoriesModule, LocationsModule],
  controllers: [AdminBuyRequestsController],
  providers: [AdminBuyRequestsService],
})
export class AdminBuyRequestsModule {}
