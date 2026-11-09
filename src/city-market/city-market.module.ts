import { Module } from '@nestjs/common';
import { CityMarketController } from './city-market.controller';
import { CityMarketService } from './city-market.service';
import { CategoriesModule } from '../categories/categories.module';
import { LocationsModule } from '../locations/locations.module';
import { UploadsModule } from '../uploads/uploads.module';

/**
 * ماژول بازار عمدهٔ شهری — عمداً مستقل از ProductsModule (خواستهٔ مالک ۹-۱۱):
 * فقط زیرساخت مشترک (Prisma/کش از CommonModule سراسری) + سرویس‌های مرجع
 * (دسته/لوکیشن/آپلود) را می‌گیرد؛ سرویس اصلی getProductList دست‌نخورده است.
 */
@Module({
  imports: [CategoriesModule, LocationsModule, UploadsModule],
  controllers: [CityMarketController],
  providers: [CityMarketService],
})
export class CityMarketModule {}
