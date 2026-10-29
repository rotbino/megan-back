import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminSurveysController } from './admin-surveys.controller';
import { AdminSurveysService } from './admin-surveys.service';

/** مدیریت نظرسنجی‌های کاربران — پنل ادمین */
@Module({
  imports: [AdminAuthModule],
  controllers: [AdminSurveysController],
  providers: [AdminSurveysService],
})
export class AdminSurveysModule {}
