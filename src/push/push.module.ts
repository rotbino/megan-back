import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { AuthModule } from '../auth/auth.module'; // JwtAuthGuard → JwtService

/** ماژول وب‌پوش (B10) — VAPID + اشتراک مرورگرها + ارسال اعلان */
@Module({
  imports: [AuthModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
