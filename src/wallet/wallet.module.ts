import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';

/** ماژول کیف پول و نردبان — شارژ کارت‌به‌کارت + نردبان ماهانه (B9) */
@Module({
  imports: [AuthModule, UploadsModule], // گارد JWT/ادمین + سرویس فایل برای فیش‌ها
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService], // مصرف توسط admin-users (A3) — منطق دامنه کپی نمی‌شود
})
export class WalletModule {}
