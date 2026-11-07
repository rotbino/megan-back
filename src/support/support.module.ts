import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/**
 * گفتگوی پشتیبانی کاربر ↔ پشتیبان — دوطرفه.
 * سمت ادمین (پاسخ‌دهی) در src/admin/admin-support زندگی می‌کند.
 */
@Module({
  imports: [AuthModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
