import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtAuthGuard } from './admin-jwt.guard';
import { AdminRolesGuard } from './admin-roles.guard';

/**
 * احراز هویت پنل ادمین — جدایی کامل از AuthModule کاربران:
 *  • JwtModule جدا با راز ADMIN_JWT_SECRET (مشتق‌شده اگر ست نشده)
 *  • توکن‌های ادمین ادعای scope='admin' دارند — گارد برمی‌گرداندش
 *  • بوت‌استرپ: ادمین پیش‌فرض در onModuleInit ساخته می‌شود (اگر نباشد)
 */
@Module({
  imports: [
    // توکن ادمین با secret جدا — راز رجیستر سراسری کاربران دست نمی‌خورد
    JwtModule.register({}),
  ],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminJwtAuthGuard, AdminRolesGuard],
  // JwtModule هم export می‌شود تا گارد در زیرماژول‌های دیگر (dashboard و…)
  // بتواند JwtService را تزریق کند — مثل الگوی AuthModule کاربران
  exports: [JwtModule, AdminJwtAuthGuard, AdminRolesGuard, AdminAuthService],
})
export class AdminAuthModule {}
