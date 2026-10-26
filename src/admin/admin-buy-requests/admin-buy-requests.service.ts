import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.module';
import { CacheService } from '../../common/cache/cache.module';
import { AppError } from '../../common/errors/app-error';
import { CategoriesService } from '../../categories/categories.service';
import { LocationsService } from '../../locations/locations.service';
import { BuyRequestsService } from '../../buy-requests/buy-requests.service';
import type { GetAdminBuyRequestListDto, ReviewAdminBuyRequestDto } from './dto';

const OID_RE = /^[0-9a-fA-F]{24}$/;

/** ردیف جدول درخواست‌های خرید ادمین — نام‌ها join + موبایل خریدار */
export interface AdminBuyRequestRow {
  id: number;
  name: string;
  description: string | null;
  status: string;
  category_name: string;
  province_name: string | null;
  city_name: string | null;
  buyer: { id: string; user_name: string; phone: string; is_verified: boolean };
  requirement_amount: number;
  unit: string;
  goal: string;
  has_history: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * فاز A4 — مدیریت درخواست‌های خرید پنل ادمین.
 *
 * مرزها (docs/ADMIN-IMPLEMENTATION.md §۱):
 *  • بازبینی از سرویس دامنه BuyRequestsService.reviewBuyRequest با export
 *    مصرف می‌شود — کپی نمی‌شود.
 *  • حذف = نرم (status='deleted')؛ ابطال کش تگ‌دار buy-requests پس از هر نوشتن.
 */
@Injectable()
export class AdminBuyRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly categories: CategoriesService,
    private readonly locations: LocationsService,
    private readonly buyRequests: BuyRequestsService,
  ) {}

  // ─── لیست + جستجو + فیلتر ──────────────────────────────────────────────────

  /** POST /admin/buy-requests/getBuyRequestList — شمارنده تب‌ها + ردیف‌های join‌شده */
  async getBuyRequestList(dto: GetAdminBuyRequestListDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));
    const s = (dto.search ?? '').trim();

    // فیلترهای غیرِ وضعیت — یک‌بار ساخته می‌شوند؛ شمارنده تب‌ها همان‌ها را می‌گیرد
    const base = await this.baseFilters(dto, s);
    const where: Prisma.BuyRequestWhereInput =
      base.length > 0 || dto.status
        ? { AND: [...base, ...(dto.status ? [{ status: dto.status }] : [])] }
        : {};

    const [total, rows, byStatus] = await Promise.all([
      this.prisma.buyRequest.count({ where }),
      this.prisma.buyRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.buyRequest.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: base.length > 0 ? { AND: base } : {},
      }),
    ]);

    const counts: Record<string, number> = { pending: 0, confirmed: 0, rejected: 0, deleted: 0 };
    for (const g of byStatus) counts[g.status] = g._count._all;
    counts.all = counts.pending + counts.confirmed + counts.rejected + counts.deleted;

    return {
      total,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      counts,
      items: await this.toRows(rows),
    };
  }

  // ─── عملیات ────────────────────────────────────────────────────────────────

  /** POST /admin/buy-requests/reviewBuyRequest — تأیید/رد درخواست (منطق دامنه) */
  async reviewBuyRequest(dto: ReviewAdminBuyRequestDto) {
    return this.buyRequests.reviewBuyRequest({
      id: dto.id,
      approve: dto.approve,
      rejectionReason: dto.rejectionReason,
    });
  }

  /** POST /admin/buy-requests/deleteBuyRequest — حذف نرم (تب حذف‌شده کاربر) */
  async deleteBuyRequest(id: number) {
    const row = await this.prisma.buyRequest.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('درخواست خرید یافت نشد.');
    if (row.status === 'deleted') return { id, status: 'deleted' as const };

    const updated = await this.prisma.buyRequest.update({
      where: { id },
      data: { status: 'deleted' },
    });
    this.cache.invalidateTag('buy-requests');
    return { id: updated.id, status: updated.status as string };
  }

  // ─── داخلی ─────────────────────────────────────────────────────────────────

  /** فیلترهای غیرِ وضعیت — استان/خریدار/دسته(زیردرخت)/جستجو؛ ساختار مشترک ردیف‌ها و شمارنده تب‌ها */
  private async baseFilters(
    dto: GetAdminBuyRequestListDto,
    s: string,
  ): Promise<Prisma.BuyRequestWhereInput[]> {
    const base: Prisma.BuyRequestWhereInput[] = [
      ...(dto.provinceId ? [{ provinceId: dto.provinceId }] : []),
      ...(dto.userId && OID_RE.test(dto.userId) ? [{ userId: dto.userId }] : []),
    ];
    if (dto.categoryId) {
      const ids = await this.categories.getSubtreeIds(dto.categoryId);
      if (ids.length > 0) base.push({ categoryId: { in: ids } });
    }
    if (s) {
      const catIds = await this.categories.searchCategoryIds(s);
      const or: Prisma.BuyRequestWhereInput[] = [
        { name: { contains: s } },
        { user: { OR: [{ phone: { contains: s } }, { userName: { contains: s } }] } },
      ];
      if (catIds.length > 0) or.push({ categoryId: { in: catIds } });
      base.push({ OR: or });
    }
    return base;
  }

  /** join نام‌ها — گروهی (خریدارها/دسته/مکان) */
  private async toRows(rows: Array<{
    id: number; name: string | null; description: string | null; status: string;
    categoryId: number; provinceId: number | null; cityId: number | null; userId: string;
    requirementAmount: number; unit: string; goal: string; hasHistory: boolean;
    createdAt: Date; updatedAt: Date;
  }>): Promise<AdminBuyRequestRow[]> {
    if (rows.length === 0) return [];

    const [userRows, catMap, locNames] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
        select: { id: true, userName: true, phone: true, isVerified: true },
      }),
      this.categories.getNameMap(),
      this.locations.getNames(
        [...new Set(rows.map((r) => r.provinceId).filter((p): p is number => p != null))],
        [...new Set(rows.map((r) => r.cityId).filter((c): c is number => c != null))],
      ),
    ]);

    const users = new Map(userRows.map((u) => [u.id, u]));
    const UNKNOWN = '—';

    return rows.map((r) => {
      const buyer = users.get(r.userId);
      return {
        id: r.id,
        name: r.name ?? '',
        description: r.description,
        status: r.status,
        category_name: catMap.get(r.categoryId)?.category_name ?? UNKNOWN,
        province_name: r.provinceId != null ? locNames.provinces.get(r.provinceId) ?? UNKNOWN : null,
        city_name: r.cityId != null ? locNames.cities.get(r.cityId) ?? UNKNOWN : null,
        buyer: {
          id: r.userId,
          user_name: buyer?.userName ?? UNKNOWN,
          phone: buyer?.phone ?? '',
          is_verified: buyer?.isVerified ?? false,
        },
        requirement_amount: r.requirementAmount,
        unit: r.unit,
        goal: r.goal,
        has_history: r.hasHistory,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      };
    });
  }
}
