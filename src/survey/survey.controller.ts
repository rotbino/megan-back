import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, type AuthUser } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ok } from '../common/api-response';
import { SurveyService } from './survey.service';
import { SubmitSurveyDto } from './dto';

/** نظرسنجی عملکرد ایمچ — فقط با توکن (پاسخ می‌آید تا فرم ویرایش پر شود). */
@ApiTags('survey')
@Controller('survey')
export class SurveyController {
  constructor(private readonly survey: SurveyService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('getMine')
  @ApiOperation({ summary: 'پاسخ نظرسنجی من (null = هنوز نداده‌ام)' })
  async getMine(@CurrentUser() user: AuthUser) {
    return ok(await this.survey.getMine(user.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // ثبت/ویرایش محدود
  @Post('submit')
  @ApiOperation({ summary: 'ثبت/ویرایش پاسخ نظرسنجی (upsert — یک پاسخ به ازای کاربر)' })
  async submit(@CurrentUser() user: AuthUser, @Body() dto: SubmitSurveyDto) {
    return ok(await this.survey.submit(user.id, dto), 'نظر شما ثبت شد.');
  }
}
