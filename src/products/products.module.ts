import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { LocationsModule } from '../locations/locations.module';
import { UploadsModule } from '../uploads/uploads.module';
import { CallsModule } from '../calls/calls.module';
import { PresenceModule } from '../presence/presence.module';

/** ماژول محصولات — آگهی‌های عمده‌فروشی عین باسکول (R4) */
@Module({
  imports: [AuthModule, CategoriesModule, LocationsModule, UploadsModule, CallsModule, PresenceModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
