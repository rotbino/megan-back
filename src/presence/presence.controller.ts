import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ok } from '../common/api-response';
import { PresenceService } from './presence.service';
import { PresenceHeartbeatDto, PresenceStatusDto } from './dto';

/**
 * ─── حضور آنلاین/آفلاین ──────────────────────────────────────────────────────
 * heartbeat: ریز و ارزان — کلاینت هر ۴۵ ثانیه می‌فرستد؛ حد نرخ بالا.
 * status: عمومی (بدون توکن) — نشانگر آنلاین در کارت فروشنده آگهی، پروفایل
 * و فرم چت مهمان‌ها هم می‌بینند؛ فقط وضعیت می‌دهد نه زمان دقیق حساس.
 * leave: خروج صریح (بستن صفحه/انقضای نشست) — توکن منقضی هم پذیرفته
 * می‌شود (امضا معتبر = هویت ثابت) تا کلاینتِ بی‌نشست بتواند خودش را
 * همان لحظه آفلاین کند.
 */
@ApiTags('presence')
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // ۴۵s کلاینت + پرش‌ها
  @Post('heartbeat')
  @ApiOperation({ summary: 'نبض حضور — هر ۴۵ ثانیه از کلاینت' })
  async heartbeat(@CurrentUser() user: { id: string }, @Body() _dto: PresenceHeartbeatDto) {
    this.presence.touch(user.id);
    return ok({ online: true });
  }

  /** بیکن خروج — بدون JwtAuthGuard چون توکن منقضی/ابطال‌شده هم باید کار کند */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('leave')
  @ApiOperation({ summary: 'خروج صریح — بستن صفحه یا پایان نشست؛ فوری آفلاین' })
  async leave(
    @Headers('authorization') authorization: string | undefined,
    @Body() _dto: PresenceHeartbeatDto,
  ) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : undefined;
    const userId = token ? await this.presence.verifyDepartingToken(token) : null;
    if (userId) this.presence.markDeparted(userId);
    return ok({ offline: true });
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('status')
  @ApiOperation({ summary: 'وضعیت آنلاین گروهی کاربران (عمومی)' })
  async status(@Body() dto: PresenceStatusDto) {
    if (!dto.ids?.length && !dto.userNames?.length) {
      return ok({ items: [] });
    }
    const items = await this.presence.statuses({ ids: dto.ids, userNames: dto.userNames });
    return ok({ items });
  }
}
