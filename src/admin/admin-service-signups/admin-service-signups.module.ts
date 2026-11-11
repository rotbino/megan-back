import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminServiceSignupsController } from './admin-service-signups.controller';
import { AdminServiceSignupsService } from './admin-service-signups.service';

/** ثبت‌نام سرویس‌های تخصصی (پنل ادمین) — فقط خواندن */
@Module({
  // AdminAuthModule: JwtService را export می‌کند — AdminJwtAuthGuard به آن نیاز دارد
  imports: [AdminAuthModule],
  controllers: [AdminServiceSignupsController],
  providers: [AdminServiceSignupsService],
})
export class AdminServiceSignupsModule {}
