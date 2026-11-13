import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { AdminAuthModule } from '../admin/admin-auth/admin-auth.module';
import { ImporterController } from './importer.controller';
import { ImporterService } from './importer.service';
import { ImportedUsersController } from './imported-users.controller';
import { ImportedUsersService } from './imported-users.service';

/**
 * ایمپورتر باسکول — ابزار داخلی ادمین (بازسازی ۱۳-۱۱).
 * PrismaModule گلوبال است. عکس‌ها از طریق UploadsService وارد می‌شوند تا
 * «دقیقاً همان مسیر/پردازش/واترمارک آپلود عادی کاربر» را بگیرند
 * (users/{userId}/… — خواستهٔ مالک ۱۳-۱۱)؛ درایور پاک‌سازی درون سرویس
 * از buildStorage ساخته می‌شود.
 *
 * ImportedUsersController (صفحهٔ «دیتا ایمپورت → مدیریت کاربران») پشت
 * AdminJwtAuthGuard است — AdminAuthModule راز/گارد توکن ادمین را می‌دهد.
 */
@Module({
  imports: [UploadsModule, AdminAuthModule],
  controllers: [ImporterController, ImportedUsersController],
  providers: [ImporterService, ImportedUsersService],
  exports: [ImporterService, ImportedUsersService],
})
export class ImporterModule {}
