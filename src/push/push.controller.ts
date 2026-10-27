import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PushService } from './push.service';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ok } from '../common/api-response';

class SubscribeDto {
  @IsString()
  @Length(10, 2048)
  endpoint!: string;

  @IsString()
  @Length(20, 200)
  p256dh!: string;

  @IsString()
  @Length(10, 200)
  auth!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  user_agent?: string;
}

class UnsubscribeDto {
  @IsString()
  @Length(10, 2048)
  endpoint!: string;
}

@ApiTags('push')
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('getPublicKey')
  @ApiOperation({ summary: 'کلید عمومی VAPID برای سابسکرایب وب‌پوش' })
  async getPublicKey() {
    return ok({ publicKey: this.push.publicKey() });
  }

  /** حد نرخ ریزتر از سراسری — اشتراک/لفو مکرر مشکوک است */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('subscribe')
  @ApiOperation({ summary: 'ثبت اشتراک پوش این مرورگر برای کاربر جاری' })
  async subscribe(@CurrentUser() user: { id: string }, @Body() dto: SubscribeDto) {
    return ok(
      await this.push.subscribe(user.id, {
        endpoint: dto.endpoint,
        p256dh: dto.p256dh,
        auth: dto.auth,
        userAgent: dto.user_agent,
      }),
      'اعلان‌ها فعال شد.',
    );
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('unsubscribe')
  @ApiOperation({ summary: 'حذف اشتراک پوش این مرورگر' })
  async unsubscribe(@CurrentUser() user: { id: string }, @Body() dto: UnsubscribeDto) {
    return ok(await this.push.unsubscribe(user.id, dto.endpoint), 'اعلان‌ها خاموش شد.');
  }
}
