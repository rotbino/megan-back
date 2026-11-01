import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface ReviewRowDto {
  id: string;
  rating: number;
  text: string;
  status: ReviewStatus;
  author: { userName: string; firstName: string; lastName: string; avatarUrl: string | null };
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
 *
 * قانون انتشار (خواسته مالک ۲-۱۱):
 *  ۱) نظر فقط با تأیید ادمین عمومی می‌شود (status: pending → approved/rejected).
 *  ۲) بلافاصله بعد از ثبت، فقط خودِ نویسنده آن را می‌بیند (myReview) +
 *     یادداشت «نظر شما بعد از تحقیق و تایید منتشر میشود».
 *  ۳) گیت تماس: فقط کاربری که با این فروشنده حداقل یک تماس (CallLog)
 *     یا چت (ChatThread) داشته می‌تواند نظر بنویسد — وگرنه خطای دقیق.
 *  ۴) ویرایش نظر = بازگشت به صف بررسی (pending دوباره).
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
    // فقط نظرهای تأییدشده عمومی‌اند — خلاصه امتیاز و توزیع هم از همین مجموعه
    const publicWhere = { sellerId: seller.id, status: 'approved' };

    const [total, agg, dist, rows, myRow] = await Promise.all([
      this.prisma.sellerReview.count({ where: publicWhere }),
      this.prisma.sellerReview.aggregate({
        where: publicWhere,
        _avg: { rating: true },
      }),
      this.prisma.sellerReview.groupBy({
        by: ['rating'],
        _count: { _all: true },
        where: publicWhere,
      }),
      this.prisma.sellerReview.findMany({
        where: publicWhere,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: { author: { select: { userName: true, firstName: true, lastName: true, avatarUrl: true } } },
      }),
      // نظر خودم با هر وضعیتی برمی‌گردد — نویسنده باید بتواند پیش‌نویس/ردشده‌اش را ببیند
      viewerId
        ? this.prisma.sellerReview.findUnique({
            where: { authorId_sellerId: { authorId: viewerId, sellerId: seller.id } },
            include: { author: { select: { userName: true, firstName: true, lastName: true, avatarUrl: true } } },
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

  /** POST /reviews/addSellerReview — ثبت/ویرایش نظر من (upsert)
   * گیت تماس/چت: فقط خریداری که حداقل یک بار با فروشنده تماس گرفته یا چت
   * کرده اجازهٔ ثبت نظر دارد (خواسته مالک ۲-۱۱ — جلوگیری از نظر غیرواقعی). */
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

    // حداقل یک تماس (دیدن شماره) یا یک گفتگو با همین فروشنده — هر دو سمت
    // از دید خریدار بررسی می‌شود: CallLog.caller=من و ChatThread.buyer=من.
    const [called, chatted] = await Promise.all([
      this.prisma.callLog.findFirst({
        where: { callerId: authorId, calleeId: seller.id },
        select: { id: true },
      }),
      this.prisma.chatThread.findFirst({
        where: { buyerId: authorId, sellerId: seller.id },
        select: { id: true },
      }),
    ]);
    if (!called && !chatted) {
      throw AppError.badRequest(
        'فقط کاربرانی که با فروشنده حداقل تماس یا چت داشته‌اند می‌توانند نظر ثبت کنند.',
        'REVIEW_NEEDS_CONTACT',
      );
    }

    // ثبت و ویرایش هر دو به صف بررسی می‌روند — نظر تأییدشده با ویرایشِ دوباره
    // نیز باید بازبینی شود (قانون انتشار مالک ۲-۱۱).
    const row = await this.prisma.sellerReview.upsert({
      where: { authorId_sellerId: { authorId, sellerId: seller.id } },
      create: { sellerId: seller.id, authorId, rating: dto.rating, text, status: 'pending' },
      update: { rating: dto.rating, text, status: 'pending' },
      include: { author: { select: { userName: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    // خلاصه امتیاز سرصفحه پروفایل از getSeller کش شده — همان لحظه تازه شود
    this.cache.invalidateTag(`seller:${dto.userName.trim()}`);
    return this.toDto(row);
  }

  private toDto(r: {
    id: string;
    rating: number;
    text: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    author: { userName: string; firstName: string; lastName: string; avatarUrl: string | null };
  }): ReviewRowDto {
    return {
      id: r.id,
      rating: r.rating,
      text: r.text,
      status: (['pending', 'approved', 'rejected'] as const).includes(r.status as ReviewStatus)
        ? (r.status as ReviewStatus)
        : 'pending',
      author: r.author,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
