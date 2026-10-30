import { Module } from '@nestjs/common';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';

/** ماژول بسته‌های اشتراک — خرید کارت‌به‌کارت + گیت‌های ظرفیت/خریداران */
@Module({
  imports: [AuthModule, UploadsModule], // گارد JWT + سرویس فایل برای فیش‌ها
  controllers: [PackagesController],
  providers: [PackagesService],
  exports: [PackagesService], // مصرف توسط admin-packages
})
export class PackagesModule {}
