import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.module';
import { CacheService } from '../../common/cache/cache.module';
import { AppError } from '../../common/errors/app-error';

export interface ReviewAdminRow {
  id: string;
  rating: number;
  text: string;
  createdAt: Date;
  updatedAt: Date;
  author: { userName: string; firstName: string; lastName: string; avatarUrl: string | null };
  seller: { userName: string; firstName: string; lastName: string; avatarUrl: string | null };
}

export interface ReviewListPage {
  items: ReviewAdminRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  stats: {
    total: number;
    avg: number;
    distribution: Array<{ rating: number; count: number }>;
    last7Days: number;
  };
}

/**
 * ─── مدیریت نظرات فروشندگان (پنل ادمین) ────────────────────────────────────
 * نظرات واقعی کاربران روی پروفایل فروشنده‌ها تا حالا هیچ معادل مدیریتی نداشت؛
 * این ماژول فهرست/آمار/حذف را می‌دهد. حذف کش getSeller فروشنده را هم
 * می‌شکند تا میانگین سرصفحه پروفایل همان لحظه اصلاح شود.
 */
@Injectable()
export class AdminReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** POST /admin/reviews/getReviewList — فهرست + آمار */
  async getReviewList(dto: { search?: string; rating?: number; page?: number; perPage?: number }): Promise<ReviewListPage> {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));
    const s = dto.search?.trim();

    const userContains = s
      ? { OR: [{ firstName: { contains: s } }, { lastName: { contains: s } }, { userName: { contains: s } }] }
      : undefined;

    const where = {
      ...(dto.rating ? { rating: dto.rating } : {}),
      ...(s
        ? {
            OR: [
              { text: { contains: s } },
              ...(userContains ? [{ author: userContains }] : []),
              ...(userContains ? [{ seller: userContains }] : []),
            ],
          }
        : {}),
    };

    const [total, agg, dist, last7Days, rows] = await Promise.all([
      this.prisma.sellerReview.count({ where }),
      this.prisma.sellerReview.aggregate({ _avg: { rating: true }, where: {} }),
      this.prisma.sellerReview.groupBy({ by: ['rating'], _count: { _all: true }, where: {} }),
      this.prisma.sellerReview.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
      this.prisma.sellerReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          author: { select: { userName: true, firstName: true, lastName: true, avatarUrl: true } },
          seller: { select: { userName: true, firstName: true, lastName: true, avatarUrl: true } },
        },
      }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        text: r.text,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        author: r.author,
        seller: r.seller,
      })),
      total,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      stats: {
        total,
        avg: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0,
        distribution: [5, 4, 3, 2, 1].map((rt) => ({
          rating: rt,
          count: dist.find((d) => d.rating === rt)?._count._all ?? 0,
        })),
        last7Days,
      },
    };
  }

  /** POST /admin/reviews/deleteReview — حذف نظر + شکستن کش پروفایل فروشنده */
  async deleteReview(id: string): Promise<{ id: string }> {
    const row = await this.prisma.sellerReview.findUnique({
      where: { id },
      select: { id: true, seller: { select: { userName: true } } },
    });
    if (!row) throw AppError.notFound('نظر یافت نشد.');

    await this.prisma.sellerReview.delete({ where: { id } });
    if (row.seller?.userName) {
      this.cache.invalidateTag(`seller:${row.seller.userName.trim()}`);
    }
    return { id };
  }
}
