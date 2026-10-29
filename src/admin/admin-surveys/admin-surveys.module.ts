import { Module } from '@nestjs/common';
import { AdminSurveysController } from './admin-surveys.controller';
import { AdminSurveysService } from './admin-surveys.service';

/** مدیریت نظرسنجی‌های کاربران — پنل ادمین */
@Module({
  controllers: [AdminSurveysController],
  providers: [AdminSurveysService],
})
export class AdminSurveysModule {}
