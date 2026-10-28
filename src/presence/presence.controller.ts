import { Body, Controller, Post, UseGuards } from '@nestjs/common';
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
