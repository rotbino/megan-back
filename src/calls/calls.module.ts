import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { AuthModule } from '../auth/auth.module';

/**
 * گزارش تماس کاربر-به-کاربر (A6) — ثبت رویداد «آشکارسازی شماره».
 * گزارش‌های ادمین (لیست/آمار) در src/admin/admin-calls قرار دارد و از
 * همین جدول CallLog می‌خواند.
 */
@Module({
  imports: [AuthModule], // JwtModule برای REST-گارد
  controllers: [CallsController],
  providers: [CallsService],
})
export class CallsModule {}
