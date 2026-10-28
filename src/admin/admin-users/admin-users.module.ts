import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { WalletModule } from '../../wallet/wallet.module';
import { VerificationModule } from '../../verification/verification.module';
import { PresenceModule } from '../../presence/presence.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

/**
 * فاز A3 — مدیریت کاربران پنل ادمین.
 *
 * جستجو/فیلتر/صفحه‌بندی + جزئیات کامل + فعال/غیرفعال (حذف نرم با ابطال نشست‌ها)
 * + نقش خریدار/فروشنده + اصلاح دستی کیف پول + بازبینی احراز اسناد.
 *
 * منطق کیف پول/احراز از سرویس‌های دامنه (export شده) مصرف می‌شود — کپی نمی‌شود
 * (اصل طلایی §۱: «ادمین منطق دامنه را copy نمی‌کند»).
 */
@Module({
  imports: [AdminAuthModule, WalletModule, VerificationModule, PresenceModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
})
export class AdminUsersModule {}
