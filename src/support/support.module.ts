import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/**
 * گفتگوی پشتیبانی کاربر ↔ پشتیبان — دوطرفه.
 * سمت ادمین (پاسخ‌دهی) در src/admin/admin-support زندگی می‌کند.
 * UploadsModule برای readMultipart آپلود پیوست (خواسته مالک ۸-۱۱).
 */
@Module({
  imports: [AuthModule, UploadsModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
