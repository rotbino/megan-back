import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { ProductsModule } from '../../products/products.module';
import { CategoriesModule } from '../../categories/categories.module';
import { LocationsModule } from '../../locations/locations.module';
import { UploadsModule } from '../../uploads/uploads.module';
import { AdminProductsController } from './admin-products.controller';
import { AdminProductsService } from './admin-products.service';

/**
 * فاز A4 — مدیریت آگهی‌های پنل ادمین.
 *
 * لیست/جزئیات join‌شده (نام دسته-مکان + موبایل فروشنده + گالری) +
 * بازبینی (منطق دامنه ProductsService — کپی نمی‌شود، اصل طلایی §۱) +
 * تغییر مستقیم وضعیت/نردبان/حذف نرم با پاک‌سازی فایل‌ها.
 */
@Module({
  imports: [AdminAuthModule, ProductsModule, CategoriesModule, LocationsModule, UploadsModule],
  controllers: [AdminProductsController],
  providers: [AdminProductsService],
})
export class AdminProductsModule {}
