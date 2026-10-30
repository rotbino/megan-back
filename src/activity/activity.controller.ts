import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { OptionalJwtAuthGuard } from '../common/guards';
import { MaybeCurrentUser } from '../common/decorators/current-user.decorator';
import { ActivityService } from './activity.service';
import { LogActivityDto } from './dto';
import { ok } from '../common/api-response';
import type { AuthUser } from '../common/guards';

/**
 * ثبت فعالیت کاربران — عمومی (مهمان هم با sessionId ثبت می‌شود).
 * محدودتر از حد سراسری: ۶۰ رویداد/دقیقه/IP — pingها سبک‌اند ولی سیل‌آسا.
 */
@ApiTags('activity')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @Post('log')
  @ApiOperation({ summary: 'ثبت یک رویداد فعالیت — search | category_view | page_view' })
  async log(
    @MaybeCurrentUser() user: AuthUser | null,
    @Body() dto: LogActivityDto,
    @Req() req: FastifyRequest,
  ) {
    const userAgent = (req.headers['user-agent'] ?? '').toString();
    return ok(await this.activity.log(dto, user, userAgent));
  }
}
