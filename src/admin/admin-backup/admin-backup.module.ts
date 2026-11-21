import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminBackupController } from './admin-backup.controller';
import { AdminBackupService } from './admin-backup.service';

/** بک‌آپ دیتابیس — AdminAuthModule برای گارد ادمین (JwtModule + AdminJwtAuthGuard) */
@Module({
  imports: [AdminAuthModule],
  controllers: [AdminBackupController],
  providers: [AdminBackupService],
})
export class AdminBackupModule {}
