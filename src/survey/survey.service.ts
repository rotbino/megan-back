import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import { FEEDBACK_CATEGORIES, type FeedbackCategory } from './dto';

export interface FeedbackRow {
  id: string;
  category: FeedbackCategory;
  title: string;
  body: string;
  isStaff: boolean;
  isMine: boolean;
  upvoteCount: number;
  hasUpvoted: boolean;
  author: { firstName: string; lastName: string } | null; // isStaff ⇒ null (بج «تیم ایمچ»)
  createdAt: Date;
}

export interface FeedbackListPage {
  items: FeedbackRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
}

const isCategory = (v: string): v is FeedbackCategory =>
  (FEEDBACK_CATEGORIES as readonly string[]).includes(v);

/**
 * ─── نظرسنجی ایمچ — «تحقیقات بازار» ─────────────────────────────────────────
 * به‌جای امتیاز ۵گانه یک‌بارمصرف: تخته بازخورد و نیازها.
 * کاربر نیاز/مشکل/انتقاد/پیشنهاد می‌فرستد (چندتایی)، فید عمومی را
 * می‌بیند (یادگیری اجتماعی) و با «من هم همین را دارم» موافقت می‌کند —
 * تعداد موافقت‌ها سیگنال تقاضای واقعی برای تیم توسعه است.
 */
@Injectable()
export class SurveyService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /survey/list — فید عمومی بازخوردها (مرتب‌سازی جدیدترین/پرموافق‌ترین) */
  async list(userId: string, dto: { category?: string; sort?: string; page?: number; perPage?: number }): Promise<FeedbackListPage> {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(30, Math.max(1, dto.perPage ?? 10));
    const where = dto.category && isCategory(dto.category) ? { category: dto.category } : {};

    const [total, rows] = await Promise.all([
      this.prisma.feedbackItem.count({ where }),
      this.prisma.feedbackItem.findMany({
        where,
        orderBy:
          dto.sort === 'top'
            ? [{ upvotes: { _count: 'desc' } }, { createdAt: 'desc' as Prisma.SortOrder }]
            : { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          user: { select: { firstName: true, lastName: true } },
          _count: { select: { upvotes: true } },
        },
      }),
    ]);

    const mine = await this.prisma.feedbackUpvote.findMany({
      where: { userId, itemId: { in: rows.map((r) => r.id) } },
      select: { itemId: true },
    });
    const upvotedIds = new Set(mine.map((m) => m.itemId));

    return {
      items: rows.map((r) => ({
        id: r.id,
        category: isCategory(r.category) ? r.category : 'critique',
        title: r.title,
        body: r.body,
        isStaff: r.isStaff,
        isMine: r.userId === userId,
        upvoteCount: r._count.upvotes,
        hasUpvoted: upvotedIds.has(r.id),
        author: r.isStaff ? null : { firstName: r.user.firstName, lastName: r.user.lastName },
        createdAt: r.createdAt,
      })),
      total,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  /** POST /survey/submit — ثبت بازخورد/نیاز جدید (چندتایی؛ محدودیت نرخ در کنترلر) */
  async submit(
    userId: string,
    dto: { category: FeedbackCategory; title: string; body: string },
  ): Promise<FeedbackRow> {
    const row = await this.prisma.feedbackItem.create({
      data: {
        userId,
        category: dto.category,
        title: dto.title.trim(),
        body: dto.body.trim(),
      },
      include: { user: { select: { firstName: true, lastName: true } }, _count: { select: { upvotes: true } } },
    });
    return {
      id: row.id,
      category: isCategory(row.category) ? row.category : 'critique',
      title: row.title,
      body: row.body,
      isStaff: row.isStaff,
      isMine: true,
      upvoteCount: row._count.upvotes,
      hasUpvoted: false,
      author: { firstName: row.user.firstName, lastName: row.user.lastName },
      createdAt: row.createdAt,
    };
  }

  /** POST /survey/upvote — toggle «من هم همین را دارم» */
  async upvote(userId: string, itemId: string): Promise<{ id: string; upvoteCount: number; hasUpvoted: boolean }> {
    const item = await this.prisma.feedbackItem.findUnique({ where: { id: itemId }, select: { id: true } });
    if (!item) throw AppError.notFound('بازخورد یافت نشد.');

    const existing = await this.prisma.feedbackUpvote.findUnique({
      where: { itemId_userId: { itemId, userId } },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.feedbackUpvote.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.feedbackUpvote.create({ data: { itemId, userId } });
    }

    const upvoteCount = await this.prisma.feedbackUpvote.count({ where: { itemId } });
    return { id: itemId, upvoteCount, hasUpvoted: !existing };
  }

  /** POST /survey/deleteMine — حذف بازخورد خودم */
  async deleteMine(userId: string, itemId: string): Promise<{ id: string }> {
    const row = await this.prisma.feedbackItem.findUnique({ where: { id: itemId }, select: { userId: true } });
    if (!row || row.userId !== userId) throw AppError.notFound('بازخورد یافت نشد.');
    await this.prisma.feedbackItem.delete({ where: { id: itemId } });
    return { id: itemId };
  }
}
