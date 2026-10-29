import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SurveyController } from './survey.controller';
import { SurveyService } from './survey.service';

/** نظرسنجی عملکرد ایمچ — یک پاسخ به ازای کاربر (upsert) */
@Module({
  imports: [AuthModule],
  controllers: [SurveyController],
  providers: [SurveyService],
  exports: [SurveyService],
})
export class SurveyModule {}
