import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, type AuthUser } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ok } from '../common/api-response';
import { SurveyService } from './survey.service';
import { ListFeedbackDto, SubmitFeedbackDto, UpvoteFeedbackDto } from './dto';

/** نظرسنجی — تخته بازخورد و نیازها (تحقیقات بازار)؛ فقط با توکن. */
@ApiTags('survey')
@Controller('survey')
export class SurveyController {
  constructor(private readonly survey: SurveyService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('list')
  @ApiOperation({ summary: 'فید بازخوردها (فیلتر دسته + مرتب‌سازی جدیدترین/پرموافق‌ترین)' })
  async list(@CurrentUser() user: AuthUser, @Body() dto: ListFeedbackDto) {
    return ok(await this.survey.list(user.id, dto));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 6, ttl: 3_600_000 } }) // حداکثر ۶ بازخورد در ساعت — اسپم‌گیری
  @Post('submit')
  @ApiOperation({ summary: 'ثبت بازخورد/نیاز جدید (چندتایی)' })
  async submit(@CurrentUser() user: AuthUser, @Body() dto: SubmitFeedbackDto) {
    return ok(await this.survey.submit(user.id, dto), 'بازخورد شما ثبت شد.');
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('upvote')
  @ApiOperation({ summary: 'toggle موافقت — «من هم همین را دارم»' })
  async upvote(@CurrentUser() user: AuthUser, @Body() dto: UpvoteFeedbackDto) {
    return ok(await this.survey.upvote(user.id, dto.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('deleteMine')
  @ApiOperation({ summary: 'حذف بازخورد خودم' })
  async deleteMine(@CurrentUser() user: AuthUser, @Body() dto: UpvoteFeedbackDto) {
    return ok(await this.survey.deleteMine(user.id, dto.id), 'بازخورد حذف شد.');
  }
}
