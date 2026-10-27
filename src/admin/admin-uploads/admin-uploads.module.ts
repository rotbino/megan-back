import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { UploadsModule } from '../../uploads/uploads.module';
import { AdminUploadsController } from './admin-uploads.controller';
import { AdminUploadsService } from './admin-uploads.service';

/**
 * فاز A5 — ماژول نگهداشت فایل ادمین.
 * UploadsService از ماژول دامنه export می‌شود — منطق کپی نمی‌شود.
 */
@Module({
  imports: [AdminAuthModule, UploadsModule],
  controllers: [AdminUploadsController],
  providers: [AdminUploadsService],
})
export class AdminUploadsModule {}
