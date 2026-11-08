import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.module';
import { AppError } from '../../common/errors/app-error';
import { FEEDBACK_CATEGORIES } from '../../survey/dto';

export interface SurveyAdminRow {
  id: string;
  category: string;
  title: string;
  body: string;
  isStaff: boolean;
  upvoteCount: number;
  createdAt: Date;
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
    byCategory: Array<{ category: string; count: number }>;
    totalUpvotes: number;
    last7Days: number;
  };
}

/**
 * ─── مدیریت بازخوردهای نظرسنجی (پنل ادمین) ────────────────────────────────
 * خروجی «تحقیقات بازار»: فهرست نیازها/مشکلات/انتقادها + آمار دسته‌ای +
 * مجموع موافقت‌ها (سیگنال تقاضا)؛ حذف بازخورد نامعتبر/توهین‌آمیز.
 */
@Injectable()
export class AdminSurveysService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /admin/surveys/getSurveyList — فهرست + آمار */
  async getSurveyList(dto: { search?: string; category?: string; page?: number; perPage?: number }): Promise<SurveyListPage> {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));

    // جستجو: متن بازخورد (عنوان/شرح) یا مشخصات نویسنده
    const term = dto.search?.trim();
    const where = {
      ...(dto.category ? { category: dto.category } : {}),
      ...(term
        ? {
            OR: [
              { title: { contains: term } },
              { body: { contains: term } },
              {
                user: {
                  OR: [
                    { firstName: { contains: term } },
                    { lastName: { contains: term } },
                    { phone: { contains: term } },
                    { userName: { contains: term } },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const [total, byCat, totalUpvotes, last7Days, rows] = await Promise.all([
      this.prisma.feedbackItem.count({ where }),
      this.prisma.feedbackItem.groupBy({ by: ['category'], _count: { _all: true }, where: {} }),
      this.prisma.feedbackUpvote.count(),
      this.prisma.feedbackItem.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      }),
      this.prisma.feedbackItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          user: { select: { id: true, userName: true, firstName: true, lastName: true, phone: true, avatarUrl: true } },
          _count: { select: { upvotes: true } },
        },
      }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        category: r.category,
        title: r.title,
        body: r.body,
        isStaff: r.isStaff,
        upvoteCount: r._count.upvotes,
        createdAt: r.createdAt,
        user: r.user,
      })),
      total,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      stats: {
        total,
        byCategory: FEEDBACK_CATEGORIES.map((c) => ({
          category: c,
          count: byCat.find((d) => d.category === c)?._count._all ?? 0,
        })),
        totalUpvotes,
        last7Days,
      },
    };
  }

  /** POST /admin/surveys/deleteSurveyResponse — حذف بازخورد */
  async deleteSurveyResponse(id: string): Promise<{ id: string }> {
    const row = await this.prisma.feedbackItem.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw AppError.notFound('بازخورد یافت نشد.');
    await this.prisma.feedbackItem.delete({ where: { id } });
    return { id };
  }
}
