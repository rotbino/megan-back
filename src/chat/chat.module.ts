import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AuthModule } from '../auth/auth.module';
import { PushModule } from '../push/push.module';
import { UploadsModule } from '../uploads/uploads.module';

/**
 * ماژول چت (B8) — REST برای عملیات + socket.io برای push.
 * اتصال WS در main.ts register می‌شود (fastify-socket.io) و احراز توکن
 * handshake از همین‌جا (ChatService.verifySocketToken) انجام می‌شود.
 * UploadsModule برای readMultipart آپلود پیوست چت (خواسته مالک ۷-۱۱).
 */
@Module({
  imports: [AuthModule, PushModule, UploadsModule], // JwtModule برای REST-گارد + توکن سوکت
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
