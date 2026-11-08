import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.module';
import { AppError } from '../../common/errors/app-error';
import { CategoriesService } from '../../categories/categories.service';

export interface AdminBookRow {
  id: string;
  user: { id: string; userName: string; firstName: string; lastName: string; phone: string };
  category: { id: number; name: string; rootName: string; parentName: string };
  minAmount: number;
  period: string;
  unit: string;
  status: string;
  rejectionReasons: string[];
  createdAt: Date;
}

export interface AdminBookListPage {
  items: AdminBookRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  counts: { all: number; pending: number; confirmed: number; rejected: number };
}

/**
 * ─── مدیریت دفتر خرید (درخواست‌های خرید دوره‌ای) — پنل ادمین ───────────────
 * خواستهٔ مالک ۸-۱۱: کالاهای دفتر خرید خریداران هم مثل درخواست‌های فوری
 * بازبینی ادمین می‌خواهند — ردیف تازه تا تأیید برای فروشندگان نامرئی است
 * (دایرکتوری خریداران فقط تاییدشده‌ها را می‌بیند).
 */
@Injectable()
export class AdminBuyerBookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {}

  /** نام دسته + مسیر (ریشه/پدر) — عین BuyersService.categoriesWithPath */
  private async categoriesWithPath(ids: number[]) {
    if (ids.length === 0) {
      return new Map<number, { name: string; rootName: string; parentName: string }>();
    }
    const uniq = [...new Set(ids)];
    const rows = await this.prisma.category.findMany({
      where: { id: { in: uniq } },
      select: { id: true, categoryName: true, parentId: true },
    });
    const parentIds = [...new Set(rows.map((r) => r.parentId).filter((x): x is number => x != null))];
    const parents = parentIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: parentIds } },
          select: { id: true, categoryName: true, parentId: true },
        })
      : [];
    const grandIds = [...new Set(parents.map((p) => p.parentId).filter((x): x is number => x != null))];
    const grands = grandIds.length
      ? await this.prisma.category.findMany({ where: { id: { in: grandIds } }, select: { id: true, categoryName: true } })
      : [];
    const parentById = new Map(parents.map((p) => [p.id, p]));
    const grandById = new Map(grands.map((g) => [g.id, g]));

    const out = new Map<number, { name: string; rootName: string; parentName: string }>();
    for (const r of rows) {
      const parent = r.parentId != null ? parentById.get(r.parentId) : undefined;
      const grand = parent?.parentId != null ? grandById.get(parent.parentId) : undefined;
      out.set(r.id, {
        name: r.categoryName,
        parentName: parent?.categoryName ?? r.categoryName,
        rootName: grand?.categoryName ?? parent?.categoryName ?? r.categoryName,
      });
    }
    return out;
  }

  /** POST /admin/buyer-book/getList — جستجو + فیلتر وضعیت + شمارندهٔ تب‌ها */
  async getList(dto: { search?: string; status?: string; page?: number; perPage?: number }): Promise<AdminBookListPage> {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));
    const term = dto.search?.trim();

    // جستجوی نام دسته — دسته‌های منطبق + زیردرختشان (شاخهٔ منطبق، برگ‌هایش را
    // هم می‌آورد)؛ در کوئری اصلی با OR به جستجوی مشخصات خریدار وصل می‌شود
    let catIdFilter: number[] | null = null;
    if (term) {
      const matched = await this.prisma.category.findMany({
        where: { categoryName: { contains: term } },
        select: { id: true },
      });
      const ids = new Set<number>();
      for (const m of matched) {
        for (const id of await this.categories.getSubtreeIds(m.id)) ids.add(id);
      }
      if (ids.size > 0) catIdFilter = [...ids];
    }

    const where: Prisma.BuyerCategoryWhereInput = {
      ...(dto.status ? { status: dto.status } : {}),
      ...(term
        ? {
            OR: [
              ...(catIdFilter ? [{ categoryId: { in: catIdFilter } }] : []),
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

    const [total, rows, byStatus] = await Promise.all([
      this.prisma.buyerCategory.count({ where }),
      this.prisma.buyerCategory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: { user: { select: { id: true, userName: true, firstName: true, lastName: true, phone: true } } },
      }),
      this.prisma.buyerCategory.groupBy({
        by: ['status'],
        _count: { _all: true },
        where,
      }),
    ]);

    const counts = { all: 0, pending: 0, confirmed: 0, rejected: 0 };
    for (const g of byStatus) {
      const n = g._count._all;
      counts.all += n;
      if (g.status === 'pending' || g.status === 'confirmed' || g.status === 'rejected') {
        counts[g.status] = n;
      }
    }

    // نام دسته‌ها + مسیر — برای نمایش
    const cats = await this.categoriesWithPath(rows.map((r) => r.categoryId));
    const items = rows.map((r) => ({
      id: r.id,
      user: r.user,
      category: {
        id: r.categoryId,
        name: cats.get(r.categoryId)?.name ?? `دسته ${r.categoryId}`,
        rootName: cats.get(r.categoryId)?.rootName ?? '',
        parentName: cats.get(r.categoryId)?.parentName ?? '',
      },
      minAmount: r.volumeMin,
      period: r.period,
      unit: r.unit,
      status: r.status,
      rejectionReasons: r.rejectionReasons ?? [],
      createdAt: r.createdAt,
    }));

    return { items, total, page, perPage, pageCount: Math.max(1, Math.ceil(total / perPage)), counts };
  }

  /** POST /admin/buyer-book/review — تأیید/رد کالای دفتر خرید */
  async review(dto: { id: string; approve: boolean; rejectionReason?: string }) {
    const row = await this.prisma.buyerCategory.findUnique({ where: { id: dto.id } });
    if (!row) throw AppError.notFound('کالای دفتر خرید یافت نشد.');
    if (!dto.approve && !dto.rejectionReason?.trim()) {
      throw AppError.badRequest('برای رد، دلیل را بنویسید.', 'REASON_REQUIRED');
    }
    const updated = await this.prisma.buyerCategory.update({
      where: { id: dto.id },
      data: {
        status: dto.approve ? 'confirmed' : 'rejected',
        rejectionReasons: dto.approve ? [] : [dto.rejectionReason!.trim()],
        reviewedAt: new Date(),
      },
    });
    return { id: updated.id, status: updated.status };
  }

  /** POST /admin/buyer-book/delete — حذف ردیف دفتر خرید (سخت) */
  async remove(id: string) {
    const row = await this.prisma.buyerCategory.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('کالای دفتر خرید یافت نشد.');
    await this.prisma.buyerCategory.delete({ where: { id } });
    return { id };
  }
}
