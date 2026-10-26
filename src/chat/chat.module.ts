import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AuthModule } from '../auth/auth.module';
import { PushModule } from '../push/push.module';

/**
 * ماژول چت (B8) — REST برای عملیات + socket.io برای push.
 * اتصال WS در main.ts register می‌شود (fastify-socket.io) و احراز توکن
 * handshake از همین‌جا (ChatService.verifySocketToken) انجام می‌شود.
 */
@Module({
  imports: [AuthModule, PushModule], // JwtModule برای REST-گارد + توکن سوکت
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
