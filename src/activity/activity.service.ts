import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { CategoriesService } from '../categories/categories.service';
import type { AdminListActivitiesDto, ActivityType } from './dto';

/** حداکثر ردیف‌های لیست ادمین */
const LIST_LIMIT = 50;
/** برش‌های آمار */
const TOP_LIMIT = 10;

export interface ActivityUserDto {
  id: string;
  firstName: string;
  lastName: string;
  userName: string;
  phone: string;
}

/**
 * ─── فعالیت کاربران (خواسته مالک ۳۰-۱۰) ────────────────────────────────────
 * جدول توسعه‌پذیر ActivityLog — فعلاً جستجو / انتخاب دسته از سایدبار / بازدید
 * صفحات. ثبت عمومی است (مهمان هم ثبت می‌شود با sessionId) و ادمین در
 * /admin/activities فهرست + آمار می‌بیند.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {}

  /** POST /activity/log — ثبت یک رویداد (append-only، best-effort UX) */
  async log(
    dto: { type: ActivityType; q?: string; categoryName?: string; path?: string; sessionId?: string },
    user: { id: string } | null,
    userAgent?: string,
  ) {
    // متن جستجو — نرمال‌سازی مثل لایه سئو فرانت (عربی→فارسی، فاصله‌ها)
    const q = dto.q?.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim().slice(0, 80) || undefined;

    // دسته انتخاب‌شده — id از درخت کش‌شده resolve می‌شود (بهترین تلاش؛
    // getSubtreeIds با نام/اسلاگ هم تطبیق می‌کند و اولین id همان خود دسته است)
    let categoryId: number | undefined;
    const categoryName = dto.categoryName?.trim().slice(0, 80) || undefined;
    if (categoryName) {
      const ids = await this.categories.getSubtreeIds(categoryName).catch(() => [] as number[]);
      categoryId = ids[0];
    }

    const row = await this.prisma.activityLog.create({
      data: {
        type: dto.type,
        userId: user?.id ?? null,
        sessionId: dto.sessionId?.slice(0, 40) || null,
        q,
        categoryId: categoryId ?? null,
        categoryName,
        path: dto.path?.slice(0, 200) || null,
        userAgent: userAgent?.slice(0, 200) || null,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  /** POST /admin/activities/list — فهرست با فیلتر نوع/متن/کاربر + صفحه‌بندی */
  async adminList(dto: AdminListActivitiesDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(LIST_LIMIT, Math.max(1, dto.perPage ?? 25));
    const q = dto.q?.trim();

    const where: Prisma.ActivityLogWhereInput = {
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.userId ? { userId: dto.userId } : {}),
      ...(q
        ? {
            OR: [{ q: { contains: q } }, { categoryName: { contains: q } }, { path: { contains: q } }],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    // مشخصات کاربران — یک کوئری گروهی، join دستی
    const userIds = [...new Set(rows.map((r) => r.userId).filter((u): u is string => u != null))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, userName: true, phone: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      items: rows.map((r) => {
        const u = r.userId != null ? userMap.get(r.userId) : undefined;
        return {
          id: r.id,
          type: r.type,
          q: r.q,
          categoryId: r.categoryId,
          categoryName: r.categoryName,
          path: r.path,
          isGuest: r.userId == null,
          sessionId: r.sessionId,
          user: u
            ? { id: u.id, firstName: u.firstName, lastName: u.lastName, userName: u.userName, phone: u.phone }
            : null,
          createdAt: r.createdAt,
        };
      }),
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  /** POST /admin/activities/stats — شمارنده‌ها + پربازدیدهای هر نوع */
  async adminStats() {
    const dayAgo = new Date(Date.now() - 86_400_000);

    const [total, today, searches, categoryViews, pageViews, topSearches, topCategories, topPages, uniqueVisitors] =
      await Promise.all([
        this.prisma.activityLog.count(),
        this.prisma.activityLog.count({ where: { createdAt: { gte: dayAgo } } }),
        this.prisma.activityLog.count({ where: { type: 'search' } }),
        this.prisma.activityLog.count({ where: { type: 'category_view' } }),
        this.prisma.activityLog.count({ where: { type: 'page_view' } }),
        this.prisma.activityLog.groupBy({
          by: ['q'],
          where: { type: 'search', q: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { q: 'desc' } },
          take: TOP_LIMIT,
        }),
        this.prisma.activityLog.groupBy({
          by: ['categoryName'],
          where: { type: 'category_view', categoryName: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { categoryName: 'desc' } },
          take: TOP_LIMIT,
        }),
        this.prisma.activityLog.groupBy({
          by: ['path'],
          where: { type: 'page_view', path: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { path: 'desc' } },
          take: TOP_LIMIT,
        }),
        this.prisma.activityLog.findMany({
          where: { createdAt: { gte: dayAgo } },
          select: { userId: true, sessionId: true },
        }),
      ]);

    // بازدیدکننده‌های یکتای ۲۴ ساعت اخیر (کاربر یا نشست مهمان)
    const seen = new Set<string>();
    for (const v of uniqueVisitors) seen.add(v.userId ?? `guest:${v.sessionId ?? 'anon'}`);

    return {
      total,
      today,
      types: { search: searches, category_view: categoryViews, page_view: pageViews },
      uniqueToday: seen.size,
      topSearches: topSearches.map((s) => ({ q: s.q!, count: s._count._all })),
      topCategories: topCategories.map((c) => ({ categoryName: c.categoryName!, count: c._count._all })),
      topPages: topPages.map((p) => ({ path: p.path!, count: p._count._all })),
    };
  }
}
