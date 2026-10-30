import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProductsModule } from '../products/products.module';
import { LocationsModule } from '../locations/locations.module';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';

/** ماژول علاقه‌مندی‌ها — نشان آگهی + ذخیره فروشنده (۳۰-۱۰) */
@Module({
  imports: [AuthModule, ProductsModule, LocationsModule],
  controllers: [FavoritesController],
  providers: [FavoritesService],
})
export class FavoritesModule {}
