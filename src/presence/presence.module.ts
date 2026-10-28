import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

/**
 * حضور آنلاین — سرویس صادر می‌شود تا ماژول‌های دیگر (چت/ادمین/محصولات)
 * isOnline/statuses/onlineCount را بدون کپی منطق مصرف کنند.
 */
@Module({
  imports: [AuthModule],
  controllers: [PresenceController],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
