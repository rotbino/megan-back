import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';

export interface ReviewRowDto {
  id: string;
  rating: number;
  text: string;
  author: { userName: string; firstName: string; lastName: string };
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerReviewsPage {
  /** خلاصه امتیاز — میانگین (یک اعشار) و شمار کل نظرها */
  summary: { avg: number; count: number; distribution: Array<{ rating: number; count: number }> };
  items: ReviewRowDto[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  /** نظر خودِ کاربر جاری درباره این فروشنده (اگر نوشته باشد) — برای ویرایش */
  myReview: ReviewRowDto | null;
}

/**
 * ─── نظرات کاربران درباره فروشنده (عین «نظرات کاربران» باسکول) ─────────────
 * هر کاربر حداکثر یک نظر برای هر فروشنده (upsert با unique [author, seller])؛
 * ویرایش نظر خودش آزاد است؛ نظر درباره خودش ممنوع. عمومی خواندنی است،
 * نوشتن فقط با توکن.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** POST /reviews/getSellerReviews — عمومی؛ خلاصه + صفحه‌بندی + نظر من */
  async getSellerReviews(viewerId: string | null, dto: { userName: string; page?: number; perPage?: number }): Promise<SellerReviewsPage> {
    const seller = await this.prisma.user.findUnique({
      where: { userName: dto.userName },
      select: { id: true, isActive: true },
    });
    if (!seller || !seller.isActive) throw AppError.notFound('فروشنده یافت نشد.');

    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(30, Math.max(1, dto.perPage ?? 10));

    const [total, agg, dist, rows, myRow] = await Promise.all([
      this.prisma.sellerReview.count({ where: { sellerId: seller.id } }),
      this.prisma.sellerReview.aggregate({
        where: { sellerId: seller.id },
        _avg: { rating: true },
      }),
      this.prisma.sellerReview.groupBy({
        by: ['rating'],
        _count: { _all: true },
        where: { sellerId: seller.id },
      }),
      this.prisma.sellerReview.findMany({
        where: { sellerId: seller.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: { author: { select: { userName: true, firstName: true, lastName: true } } },
      }),
      viewerId
        ? this.prisma.sellerReview.findUnique({
            where: { authorId_sellerId: { authorId: viewerId, sellerId: seller.id } },
            include: { author: { select: { userName: true, firstName: true, lastName: true } } },
          })
        : null,
    ]);

    return {
      summary: {
        avg: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0,
        count: total,
        distribution: [5, 4, 3, 2, 1].map((r) => ({
          rating: r,
          count: dist.find((d) => d.rating === r)?._count._all ?? 0,
        })),
      },
      items: rows.map((r) => this.toDto(r)),
      total,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      myReview: myRow ? this.toDto(myRow) : null,
    };
  }

  /** POST /reviews/addSellerReview — ثبت/ویرایش نظر من (upsert) */
  async addSellerReview(authorId: string, dto: { userName: string; rating: number; text: string }): Promise<ReviewRowDto> {
    const seller = await this.prisma.user.findUnique({
      where: { userName: dto.userName },
      select: { id: true, isActive: true },
    });
    if (!seller || !seller.isActive) throw AppError.notFound('فروشنده یافت نشد.');
    if (seller.id === authorId) {
      throw AppError.badRequest('نظر درباره خودتان ثبت نمی‌شود.', 'SELF_REVIEW');
    }

    const text = dto.text.trim();
    if (!text || text.length < 3) {
      throw AppError.badRequest('متن نظر خیلی کوتاه است (حداقل ۳ نویسه).', 'REVIEW_TOO_SHORT');
    }

    const row = await this.prisma.sellerReview.upsert({
      where: { authorId_sellerId: { authorId, sellerId: seller.id } },
      create: { sellerId: seller.id, authorId, rating: dto.rating, text },
      update: { rating: dto.rating, text },
      include: { author: { select: { userName: true, firstName: true, lastName: true } } },
    });
    // خلاصه امتیاز سرصفحه پروفایل از getSeller کش شده — همان لحظه تازه شود
    this.cache.invalidateTag(`seller:${dto.userName.trim()}`);
    return this.toDto(row);
  }

  private toDto(r: {
    id: string;
    rating: number;
    text: string;
    createdAt: Date;
    updatedAt: Date;
    author: { userName: string; firstName: string; lastName: string };
  }): ReviewRowDto {
    return {
      id: r.id,
      rating: r.rating,
      text: r.text,
      author: r.author,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
