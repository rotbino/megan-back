import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { SURVEY_SCORES, type SurveyScore } from './dto';

export interface MySurveyDto {
  score: SurveyScore;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const isScore = (v: string): v is SurveyScore => (SURVEY_SCORES as readonly string[]).includes(v);

/**
 * ─── نظرسنجی عملکرد ایمچ (عین نظرسنجی باسکول) ─────────────────────────────
 * هر کاربر حداکثر یک پاسخ (userId یکتا)؛ ثبت مجدد = ویرایش نظر خودش.
 * پاسخ‌ها از پنل ادمین (admin-surveys) دیده/حذف می‌شوند و آمارشان
 * به‌صورت توزیع پنج‌گانه + شمار یادداشت‌دار برمی‌گردد.
 */
@Injectable()
export class SurveyService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /survey/getMine — پاسخ فعلی کاربر جاری (برای ویرایش فرم) */
  async getMine(userId: string): Promise<MySurveyDto | null> {
    const row = await this.prisma.surveyResponse.findUnique({
      where: { userId },
      select: { score: true, note: true, createdAt: true, updatedAt: true },
    });
    return row && isScore(row.score)
      ? { score: row.score, note: row.note, createdAt: row.createdAt, updatedAt: row.updatedAt }
      : null;
  }

  /** POST /survey/submit — ثبت/ویرایش پاسخ (upsert روی userId یکتا) */
  async submit(userId: string, dto: { score: SurveyScore; note?: string }): Promise<MySurveyDto> {
    const note = dto.note?.trim() ? dto.note.trim() : null;
    const row = await this.prisma.surveyResponse.upsert({
      where: { userId },
      create: { userId, score: dto.score, note },
      update: { score: dto.score, note },
      select: { score: true, note: true, createdAt: true, updatedAt: true },
    });
    return { ...row, score: isScore(row.score) ? row.score : 'average' };
  }
}
