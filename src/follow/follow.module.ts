import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { LocationsModule } from '../locations/locations.module';
import { UploadsModule } from '../uploads/uploads.module';
import { FollowController } from './follow.controller';
import { FollowService } from './follow.service';

/** پیگیری‌ها — CRM کوچک ایمچ (پرونده + قیف وضعیت + یادداشت زمان‌دار) */
@Module({
  imports: [CategoriesModule, LocationsModule, UploadsModule], // نام‌های join‌شده + گالری آگهی
  controllers: [FollowController],
  providers: [FollowService],
  exports: [FollowService],
})
export class FollowModule {}
