import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.module';
import { AppError } from '../../common/errors/app-error';

export interface SurveyAdminRow {
  id: string;
  score: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    userName: string;
    firstName: string;
    lastName: string;
    phone: string;
    avatarUrl: string | null;
  };
}

export interface SurveyListPage {
  items: SurveyAdminRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  stats: {
    total: number;
    withNote: number;
    distribution: Array<{ score: string; count: number }>;
    last7Days: number;
  };
}

/**
 * ─── مدیریت نظرسنجی‌های کاربران (پنل ادمین) ────────────────────────────────
 * فهرست پاسخ‌ها + آمار توزیع پنج‌گانه؛ حذف پاسخ نامعتبر/توهین‌آمیز.
 */
@Injectable()
export class AdminSurveysService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /admin/surveys/getSurveyList — فهرست + آمار */
  async getSurveyList(dto: { search?: string; score?: string; withNote?: string; page?: number; perPage?: number }): Promise<SurveyListPage> {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));

    const userFilter = dto.search?.trim()
      ? {
          OR: [
            { firstName: { contains: dto.search.trim() } },
            { lastName: { contains: dto.search.trim() } },
            { phone: { contains: dto.search.trim() } },
            { userName: { contains: dto.search.trim() } },
          ],
        }
      : undefined;

    const where = {
      ...(dto.score ? { score: dto.score } : {}),
      ...(dto.withNote === 'true' ? { note: { not: null } } : {}),
      ...(userFilter ? { user: userFilter } : {}),
    };

    const [total, dist, withNote, last7Days, rows] = await Promise.all([
      this.prisma.surveyResponse.count({ where }),
      this.prisma.surveyResponse.groupBy({ by: ['score'], _count: { _all: true }, where: {} }),
      this.prisma.surveyResponse.count({ where: { note: { not: null } } }),
      this.prisma.surveyResponse.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      }),
      this.prisma.surveyResponse.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          user: { select: { id: true, userName: true, firstName: true, lastName: true, phone: true, avatarUrl: true } },
        },
      }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        score: r.score,
        note: r.note,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        user: r.user,
      })),
      total,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      stats: {
        total,
        withNote,
        distribution: ['excellent', 'good', 'average', 'bad', 'very_bad'].map((s) => ({
          score: s,
          count: dist.find((d) => d.score === s)?._count._all ?? 0,
        })),
        last7Days,
      },
    };
  }

  /** POST /admin/surveys/deleteSurveyResponse — حذف پاسخ */
  async deleteSurveyResponse(id: string): Promise<{ id: string }> {
    const row = await this.prisma.surveyResponse.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw AppError.notFound('پاسخ نظرسنجی یافت نشد.');
    await this.prisma.surveyResponse.delete({ where: { id } });
    return { id };
  }
}
