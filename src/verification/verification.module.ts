import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';

/** ماژول احراز هویت اسناد — کارت ملی + سلفی → جریان تأیید ادمین (B6) */
@Module({
  imports: [AuthModule, UploadsModule], // گارد JWT/ادمین + سرویس فایل برای مدارک
  controllers: [VerificationController],
  providers: [VerificationService],
})
export class VerificationModule {}
