import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { ActivityModule } from '../../activity/activity.module';
import { AdminActivitiesController } from './admin-activities.controller';

/** ماژول ادمین فعالیت کاربران — سرویس از ActivityModule مشترک است */
@Module({
  imports: [AdminAuthModule, ActivityModule],
  controllers: [AdminActivitiesController],
})
export class AdminActivitiesModule {}
