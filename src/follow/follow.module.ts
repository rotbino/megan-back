import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { LocationsModule } from '../locations/locations.module';
import { UploadsModule } from '../uploads/uploads.module';
import { FollowController } from './follow.controller';
import { FollowService } from './follow.service';

/** پیگیری‌ها — CRM کوچک ایمچ (پرونده + قیف وضعیت + یادداشت زمان‌دار) */
@Module({
  // AuthModule: JwtModule/JwtService را export می‌کند — کنترلر با
  // @UseGuards(JwtAuthGuard) گارد را در زمینهٔ همین ماژول می‌سازد؛ بدون
  // این import سرویس DI گارد را نمی‌تواند resolve کند (خطای UnknownDependencies).
  imports: [AuthModule, CategoriesModule, LocationsModule, UploadsModule], // نام‌های join‌شده + گالری آگهی
  controllers: [FollowController],
  providers: [FollowService],
  exports: [FollowService],
})
export class FollowModule {}
