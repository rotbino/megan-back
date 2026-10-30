import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

/** ماژول فعالیت کاربران — ثبت عمومی + فهرست/آمار ادمین (۳۰-۱۰) */
@Module({
  imports: [AuthModule, CategoriesModule],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService], // ادمین از همین سرویس استفاده می‌کند
})
export class ActivityModule {}
