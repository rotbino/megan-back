import { Module } from '@nestjs/common';
import { BuyRequestsController } from './buy-requests.controller';
import { BuyRequestsService } from './buy-requests.service';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { LocationsModule } from '../locations/locations.module';

/** ماژول درخواست‌های خرید (RFQ) — B7 */
@Module({
  imports: [AuthModule, CategoriesModule, LocationsModule],
  controllers: [BuyRequestsController],
  providers: [BuyRequestsService],
  exports: [BuyRequestsService], // ماژول saved برای نشان‌کردن خریدار
})
export class BuyRequestsModule {}
