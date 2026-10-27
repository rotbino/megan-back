import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CallsService } from './calls.service';
import { ReportCallDto } from './dto';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';

@ApiTags('calls')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
/** حد نرخ بالا — ثبت best-effort و سبک؛ نباید تجربه «نمایش شماره» را کند کند */
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Post('reportCall')
  @ApiOperation({
    summary: 'ثبت تماس کاربر-به-کاربر — لحظه آشکارسازی شماره (ضد-تکرار ۶۰ دقیقه)',
  })
  async reportCall(@CurrentUser() user: AuthUser, @Body() dto: ReportCallDto) {
    return ok(await this.calls.reportCall(user, dto));
  }
}
