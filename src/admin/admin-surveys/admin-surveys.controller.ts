import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { ok } from '../../common/api-response';
import { AdminSurveysService } from './admin-surveys.service';
import { DeleteSurveyDto, GetSurveyListDto } from './dto';

/** نظرسنجی‌های کاربران — خواندن/حذف از پنل ادمین (فاز ممیزی ناقص‌ها). */
@ApiTags('admin/surveys')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Controller('admin/surveys')
export class AdminSurveysController {
  constructor(private readonly surveys: AdminSurveysService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('getSurveyList')
  @ApiOperation({ summary: 'فهرست پاسخ‌های نظرسنجی + آمار توزیع/یادداشت' })
  async getSurveyList(@Body() dto: GetSurveyListDto) {
    return ok(await this.surveys.getSurveyList(dto));
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('deleteSurveyResponse')
  @ApiOperation({ summary: 'حذف یک پاسخ نظرسنجی' })
  async deleteSurveyResponse(@Body() dto: DeleteSurveyDto) {
    return ok(await this.surveys.deleteSurveyResponse(dto.id), 'پاسخ نظرسنجی حذف شد.');
  }
}
