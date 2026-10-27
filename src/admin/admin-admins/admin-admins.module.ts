import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminAdminsController } from './admin-admins.controller';
import { AdminAdminsService } from './admin-admins.service';

/**
 * فاز A5 — ماژول مدیریت ادمین‌ها (فقط SUPER_ADMIN).
 * نقش‌ها با AdminRolesGuard (متادیتای adminRoles) کنترل می‌شوند.
 */
@Module({
  imports: [AdminAuthModule],
  controllers: [AdminAdminsController],
  providers: [AdminAdminsService],
})
export class AdminAdminsModule {}
