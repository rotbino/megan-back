import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { WalletModule } from '../../wallet/wallet.module';
import { AdminWalletController } from './admin-wallet.controller';
import { AdminWalletService } from './admin-wallet.service';

/**
 * فاز A5 — ماژول صف شارژهای ادمین.
 * WalletService از ماژول دامنه export می‌شود — منطق کپی نمی‌شود.
 */
@Module({
  imports: [AdminAuthModule, WalletModule],
  controllers: [AdminWalletController],
  providers: [AdminWalletService],
})
export class AdminWalletModule {}
