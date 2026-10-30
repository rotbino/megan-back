import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.module';
import { CacheService } from '../../common/cache/cache.module';
import { AppError } from '../../common/errors/app-error';
import type { UpsertCategoryDto, UpsertLocationDto } from './dto';

/** شروع id دسته‌های جدید — بالاتر از کل idهای باسکول */
const CATEGORY_COUNTER_START = 950_000;
/** شروع id مکان‌های جدید — بالاتر از idهای باسکول */
const LOCATION_COUNTER_START = 500_000;
/** حداکثر عمق درخت دسته (ریشه=۱) */
const MAX_CATEGORY_DEPTH = 3;

/** تبدیل نام فارسی به slug — عین الگوی باقی پروژه */
function slugify(name: string): string {
  return name
    .trim()
    .replace(/[\s،/]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

/**
 * مدیریت اطلاعات پایه (فاز A2) — دسته‌بندی‌ها و مکان‌ها.
 *
 * ساختار درست داده از ابتدا رعایت شده: تغییر نام دسته/مکان فقط جدول پایه را
 * به‌روز می‌کند؛ آگهی‌ها/درخواست‌ها فقط شناسه ارجاع دارند و نام تازه را
 * هنگام خواندن با join می‌گیرند (بدون denorm برای sync).
 */
/** نود درخت دسته برای جدول مدیریت — با شمارنده‌ها.
 *  نوع کالا (Good) دیگر نود درخت نیست — تب جداگانه «انواع کالا» دارد. */
export interface AdminCategoryNode {
  id: number;
  categoryName: string;
  slug: string;
  unit: string;
  min: number;
  example: string | null;
  parentId: number | null;
  parentName: string | null;
  score: number;
  childCount: number;
  productCount: number;
  requestCount: number;
  children: AdminCategoryNode[];
}

@Injectable()
export class AdminBaseDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  // ─── دسته‌بندی‌ها ──────────────────────────────────────────────────────────

  /**
   * POST /admin/base-data/getCategoryTree — درخت کامل + شمارش فرزند/آگهی/درخواست
   * برای جدول مدیریت (فقط دسته‌ها — انواع کالا جدول Good).
   */
  async getCategoryTree() {
    const [rows, childCounts, productCounts, requestCounts] = await Promise.all([
      this.prisma.category.findMany({ orderBy: [{ parentId: 'asc' }, { score: 'desc' }] }),
      this.prisma.category.groupBy({
        by: ['parentId'],
        _count: { _all: true },
        where: { parentId: { not: null } },
      }),
      this.prisma.product.groupBy({ by: ['subCategoryId'], _count: { _all: true } }),
      this.prisma.buyRequest.groupBy({ by: ['categoryId'], _count: { _all: true } }),
    ]);

    const childMap = new Map(childCounts.map((c) => [c.parentId, c._count._all]));
    const productMap = new Map(productCounts.map((p) => [p.subCategoryId, p._count._all]));
    const requestMap = new Map(requestCounts.map((r) => [r.categoryId, r._count._all]));
    const byId = new Map(rows.map((r) => [r.id, r]));

    const enriched: Array<Omit<AdminCategoryNode, 'children'>> = rows.map((c) => ({
      id: c.id,
      categoryName: c.categoryName,
      slug: c.slug,
      unit: c.unit,
      min: c.min,
      example: c.example ?? null,
      parentId: c.parentId ?? null,
      parentName: c.parentId != null ? byId.get(c.parentId)?.categoryName ?? null : null,
      score: c.score,
      childCount: childMap.get(c.id) ?? 0,
      productCount: productMap.get(c.id) ?? 0,
      requestCount: requestMap.get(c.id) ?? 0,
    }));

    // درخت با فرزندان تازه (شمارنده‌ها روی نود)
    const nodes = new Map<number, AdminCategoryNode>();
    for (const e of enriched) {
      nodes.set(e.id, { ...e, children: [] });
    }
    const tree: AdminCategoryNode[] = [];
    for (const e of enriched) {
      const node = nodes.get(e.id)!;
      const parent = e.parentId != null ? nodes.get(e.parentId) : undefined;
      if (parent) parent.children.push(node);
      else tree.push(node);
    }
    return tree;
  }

  /** POST /admin/base-data/upsertCategory — ایجاد/ویرایش با اعتبارسنجی درخت */
  async upsertCategory(dto: UpsertCategoryDto) {
    const isCreate = dto.id == null;
    if (!isCreate) {
      const exists = await this.prisma.category.findUnique({ where: { id: dto.id } });
      if (!exists) throw AppError.notFound('دسته مورد نظر پیدا نشد.');
    }

    // والد: باید موجود باشد؛ چرخه و عمق غیرمجاز رد می‌شود
    let parentId: number | null = null;
    let parentDepth = 0;
    if (dto.parentId != null && dto.parentId !== 0) {
      const parent = await this.prisma.category.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw AppError.badRequest('دسته والد وجود ندارد.', 'BAD_PARENT');
      if (!isCreate && dto.id != null) {
        let cursor: { id: number; parentId: number | null } | null = parent;
        while (cursor) {
          if (cursor.id === dto.id) {
            throw AppError.badRequest('جابه‌جایی دسته زیر خودش مجاز نیست (چرخه).', 'CATEGORY_CYCLE');
          }
          cursor =
            cursor.parentId == null
              ? null
              : await this.prisma.category.findUnique({ where: { id: cursor.parentId } });
        }
      }
      parentId = parent.id;
      parentDepth = await this.depthOf(parent.id);
    }

    // عمق: والد حداکثر سطح ۲ → فرزند سطح ۳ (برگ)
    if (isCreate && parentId != null && parentDepth >= MAX_CATEGORY_DEPTH) {
      throw AppError.badRequest(
        `درخت دسته حداکثر ${MAX_CATEGORY_DEPTH} سطح دارد.`,
        'MAX_DEPTH',
      );
    }

    // یکتایی نام در میان خواهر-برادرها
    const sibling = await this.prisma.category.findFirst({
      where: {
        parentId,
        categoryName: dto.categoryName.trim(),
        ...(isCreate ? {} : { id: { not: dto.id } }),
      },
    });
    if (sibling) throw AppError.conflict('دسته‌ای با همین نام در این سطح وجود دارد.', 'DUPLICATE_NAME');

    // slug یکتا — در تداخل پسوند یکتا
    let slug = slugify(dto.categoryName);
    const slugTaken = await this.prisma.category.findFirst({
      where: { slug, ...(isCreate ? {} : { id: { not: dto.id } }) },
    });
    if (slugTaken) slug = `${slug}-${Date.now().toString(36)}`;

    if (isCreate) {
      const id = await this.nextId('category', CATEGORY_COUNTER_START);
      const created = await this.prisma.category.create({
        data: {
          id,
          categoryName: dto.categoryName.trim(),
          slug,
          parentId,
          unit: dto.unit?.trim() || 'کیلوگرم',
          min: dto.min ?? 100,
          example: dto.example?.trim() || null,
          score: dto.score ?? 0,
        },
      });
      this.invalidateCategoryCaches();
      return created;
    }

    const updated = await this.prisma.category.update({
      where: { id: dto.id! },
      data: {
        categoryName: dto.categoryName.trim(),
        slug,
        ...(parentId != null || dto.parentId === null || dto.parentId === 0
          ? { parentId: dto.parentId === 0 ? null : parentId }
          : {}),
        ...(dto.unit != null ? { unit: dto.unit.trim() } : {}),
        ...(dto.min != null ? { min: dto.min } : {}),
        ...(dto.example !== undefined ? { example: dto.example?.trim() || null } : {}),
        ...(dto.score != null ? { score: dto.score } : {}),
      },
    });
    this.invalidateCategoryCaches();
    return updated;
  }

  /** POST /admin/base-data/deleteCategory — فقط بدون فرزند و بدون ارجاع */
  async deleteCategory(id: number) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw AppError.notFound('دسته مورد نظر پیدا نشد.');

    const [childCount, productCount, parentRefCount, requestCount] = await Promise.all([
      this.prisma.category.count({ where: { parentId: id } }),
      this.prisma.product.count({ where: { subCategoryId: id } }),
      this.prisma.product.count({ where: { categoryId: id } }),
      this.prisma.buyRequest.count({ where: { categoryId: id } }),
    ]);

    if (childCount > 0) {
      throw AppError.conflict('ابتدا زیردسته‌های این دسته را حذف یا منتقل کنید.', 'HAS_CHILDREN');
    }
    if (productCount > 0 || parentRefCount > 0) {
      throw AppError.conflict('آگهی‌هایی به این دسته ارجاع دارند؛ حذف آن ممکن نیست.', 'IN_USE');
    }
    if (requestCount > 0) {
      throw AppError.conflict('درخواست‌های خریدی به این دسته ارجاع دارند؛ حذف آن ممکن نیست.', 'IN_USE');
    }

    await this.prisma.category.delete({ where: { id } });
    this.invalidateCategoryCaches();
    return { id, deleted: true };
  }

  // ─── انواع کالا (Good) — ورودی آزاد کاربران، جداشده از درخت ────────────────

  /**
   * POST /admin/base-data/getGoods — فهرست انواع کالا با نام دسته + تعداد
   * درخواست‌هایی که به هر نوع ارجاع دارند (تب «انواع کالا» صفحه دسته‌بندی‌ها).
   */
  async getGoods(dto: { categoryId?: number; q?: string; page?: number; perPage?: number }) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(100, Math.max(1, dto.perPage ?? 20));
    const where = {
      ...(dto.categoryId != null ? { categoryId: dto.categoryId } : {}),
      ...(dto.q?.trim() ? { name: { contains: dto.q.trim() } } : {}),
    };

    const [rows, total, requestCounts] = await Promise.all([
      this.prisma.good.findMany({
        where,
        orderBy: [{ usageCount: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.good.count({ where }),
      this.prisma.buyRequest.groupBy({ by: ['goodId'], _count: { _all: true } }),
    ]);

    const requestMap = new Map(requestCounts.map((r) => [r.goodId, r._count._all]));
    const catIds = [...new Set(rows.map((g) => g.categoryId))];
    const cats = await this.prisma.category.findMany({
      where: { id: { in: catIds } },
      select: { id: true, categoryName: true, parentId: true },
    });
    const catMap = new Map(cats.map((c) => [c.id, c]));
    // اجداد دسته‌ها — مرحله‌به‌مرحله بالا می‌رویم تا ریشه (حداکثر ۳ سطح)
    for (let level = 0; level < 3; level++) {
      const nextIds = new Set<number>();
      for (const c of catMap.values()) {
        if (c.parentId != null && !catMap.has(c.parentId)) nextIds.add(c.parentId);
      }
      if (nextIds.size === 0) break;
      const parents = await this.prisma.category.findMany({
        where: { id: { in: [...nextIds] } },
        select: { id: true, categoryName: true, parentId: true },
      });
      for (const p of parents) catMap.set(p.id, p);
    }

    /** مسیر کامل مثل «کشاورزی ← خشکبار ← پسته» */
    const fullPath = (catId: number): string => {
      const names: string[] = [];
      let cursor = catMap.get(catId);
      let hops = 0;
      while (cursor && hops < 4) {
        names.unshift(cursor.categoryName);
        cursor = cursor.parentId != null ? catMap.get(cursor.parentId) : undefined;
        hops++;
      }
      return names.join(' ← ') || '—';
    };

    return {
      items: rows.map((g) => {
        return {
          id: g.id,
          name: g.name,
          categoryId: g.categoryId,
          categoryName: catMap.get(g.categoryId)?.categoryName ?? '—',
          /** مسیر دسته مثل «کشاورزی ← خشکبار ← پسته» */
          categoryPath: fullPath(g.categoryId),
          usageCount: g.usageCount,
          requestCount: requestMap.get(g.id) ?? 0,
          createdAt: g.createdAt,
        };
      }),
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  /** POST /admin/base-data/deleteGood — حذف نوع کالا (فقط بدون ارجاع درخواست) */
  async deleteGood(id: number) {
    const good = await this.prisma.good.findUnique({ where: { id } });
    if (!good) throw AppError.notFound('نوع کالا مورد نظر پیدا نشد.');

    const requestCount = await this.prisma.buyRequest.count({ where: { goodId: id } });
    if (requestCount > 0) {
      throw AppError.conflict(
        'درخواست‌های خریدی به این نوع کالا ارجاع دارند؛ حذف آن ممکن نیست.',
        'IN_USE',
      );
    }

    await this.prisma.good.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ─── مکان‌ها (استان/شهر) ──────────────────────────────────────────────────

  /**
   * POST /admin/base-data/getLocations — درخت استان→شهر + وضعیت فعال +
   * شمارش فرزند/ارجاع برای جدول مدیریت. provinceId داده شود فقط آن استان.
   */
  async getLocations(provinceId?: number) {
    const [provinces, cities, cityCounts, userCounts, productCounts] = await Promise.all([
      this.prisma.location.findMany({
        where: { type: 'province', ...(provinceId != null ? { buskolId: provinceId } : {}) },
        orderBy: { name: 'asc' },
      }),
      this.prisma.location.findMany({
        where: {
          type: 'city',
          ...(provinceId != null ? { parentId: `province:${provinceId}` } : {}),
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.location.groupBy({
        by: ['parentId'],
        _count: { _all: true },
        where: { type: 'city', parentId: { not: null } },
      }),
      this.prisma.user.groupBy({ by: ['cityId'], _count: { _all: true }, where: { cityId: { not: null } } }),
      this.prisma.product.groupBy({ by: ['cityId'], _count: { _all: true } }),
    ]);

    const cityCountByProvince = new Map(
      cityCounts.map((c) => [Number(c.parentId?.split(':')[1]), c._count._all]),
    );
    const userCountByCity = new Map(userCounts.map((u) => [u.cityId, u._count._all]));
    const productCountByCity = new Map(productCounts.map((p) => [p.cityId, p._count._all]));

    return {
      provinces: provinces.map((p) => ({
        id: p.buskolId,
        name: p.name,
        enName: p.enName ?? null,
        isActive: p.isActive,
        cityCount: cityCountByProvince.get(p.buskolId) ?? 0,
      })),
      cities: cities.map((c) => ({
        id: c.buskolId,
        name: c.name,
        enName: c.enName ?? null,
        isActive: c.isActive,
        provinceId: Number(c.parentId?.split(':')[1] ?? 0),
        userCount: userCountByCity.get(c.buskolId) ?? 0,
        productCount: productCountByCity.get(c.buskolId) ?? 0,
      })),
    };
  }

  /** POST /admin/base-data/upsertLocation — ایجاد/ویرایش استان یا شهر */
  async upsertLocation(dto: UpsertLocationDto) {
    const name = dto.name.trim();

    if (dto.type === 'province') {
      if (dto.parentId != null) {
        throw AppError.badRequest('استان والد ندارد.', 'BAD_PARENT');
      }
      const duplicate = await this.prisma.location.findFirst({
        where: {
          type: 'province',
          name,
          ...(dto.buskolId != null ? { buskolId: { not: dto.buskolId } } : {}),
        },
      });
      if (duplicate) throw AppError.conflict('استانی با همین نام وجود دارد.', 'DUPLICATE_NAME');

      if (dto.buskolId != null) {
        const key = `province:${dto.buskolId}`;
        const exists = await this.prisma.location.findUnique({ where: { id: key } });
        if (!exists || exists.type !== 'province') {
          throw AppError.notFound('استان مورد نظر پیدا نشد.');
        }
        const updated = await this.prisma.location.update({
          where: { id: key },
          data: { name, ...(dto.enName !== undefined ? { enName: dto.enName?.trim() || null } : {}) },
        });
        this.invalidateLocationCaches();
        return this.locationDto(updated);
      }

      const buskolId = await this.nextId('location', LOCATION_COUNTER_START);
      const created = await this.prisma.location.create({
        data: { id: `province:${buskolId}`, buskolId, type: 'province', name, enName: dto.enName?.trim() || null },
      });
      this.invalidateLocationCaches();
      return this.locationDto(created);
    }

    // شهر — والد (استان) الزامی
    if (dto.parentId == null) {
      throw AppError.badRequest('برای شهر، استان والد الزامی است.', 'CITY_PARENT_REQUIRED');
    }
    const parentKey = `province:${dto.parentId}`;
    const parent = await this.prisma.location.findUnique({ where: { id: parentKey } });
    if (!parent || parent.type !== 'province') {
      throw AppError.badRequest('استان والد وجود ندارد.', 'BAD_PARENT');
    }

    const duplicate = await this.prisma.location.findFirst({
      where: {
        type: 'city',
        parentId: parentKey,
        name,
        ...(dto.buskolId != null ? { buskolId: { not: dto.buskolId } } : {}),
      },
    });
    if (duplicate) throw AppError.conflict('شهری با همین نام در این استان وجود دارد.', 'DUPLICATE_NAME');

    if (dto.buskolId != null) {
      const key = `city:${dto.buskolId}`;
      const exists = await this.prisma.location.findUnique({ where: { id: key } });
      if (!exists || exists.type !== 'city') throw AppError.notFound('شهر مورد نظر پیدا نشد.');

      const updated = await this.prisma.location.update({
        where: { id: key },
        data: { name, parentId: parentKey, ...(dto.enName !== undefined ? { enName: dto.enName?.trim() || null } : {}) },
      });
      this.invalidateLocationCaches();
      return this.locationDto(updated);
    }

    const buskolId = await this.nextId('location', LOCATION_COUNTER_START);
    const created = await this.prisma.location.create({
      data: { id: `city:${buskolId}`, buskolId, type: 'city', parentId: parentKey, name, enName: dto.enName?.trim() || null },
    });
    this.invalidateLocationCaches();
    return this.locationDto(created);
  }

  /**
   * POST /admin/base-data/setLocationActive — فعال/غیرفعال کردن مکان.
   * مکان غیرفعال از لیست‌های عمومی پنهان می‌شود و ثبت آگهی/درخواست جدید روی آن
   * رد می‌شود؛ آگهی‌های قدیمی نامشان را همچنان resolve می‌کنند (join با id).
   */
  async setLocationActive(buskolId: number, type: 'province' | 'city', active: boolean) {
    const key = `${type}:${buskolId}`;
    const exists = await this.prisma.location.findUnique({ where: { id: key } });
    if (!exists || exists.type !== type) throw AppError.notFound('مکان مورد نظر پیدا نشد.');

    const updated = await this.prisma.location.update({ where: { id: key }, data: { isActive: active } });
    this.invalidateLocationCaches();
    return this.locationDto(updated);
  }

  // ─── داخلی ─────────────────────────────────────────────────────────────────

  private locationDto(l: { id: string; buskolId: number; type: string; parentId: string | null; name: string; enName: string | null; isActive: boolean }) {
    return {
      id: l.buskolId,
      type: l.type,
      parentId: l.parentId != null ? Number(l.parentId.split(':')[1]) : null,
      name: l.name,
      enName: l.enName ?? null,
      isActive: l.isActive,
    };
  }

  /** عمق نود از ریشه (ریشه=۱) */
  private async depthOf(id: number): Promise<number> {
    let depth = 1;
    let cursor = await this.prisma.category.findUnique({ where: { id } });
    while (cursor?.parentId != null) {
      cursor = await this.prisma.category.findUnique({ where: { id: cursor.parentId } });
      depth++;
    }
    return depth;
  }

  /** id عددی افزایشی — increment اتمیک روی Counter */
  private async nextId(counterId: string, start: number): Promise<number> {
    const counter = await this.prisma.counter.upsert({
      where: { id: counterId },
      create: { id: counterId, seq: start },
      update: { seq: { increment: 1 } },
    });
    return counter.seq;
  }

  /** ابطال کش‌های دسته — درخت عمومی + لیست‌های کش‌شده آگهی (نام join است) */
  private invalidateCategoryCaches(): void {
    this.cache.invalidateTag('categories');
    this.cache.invalidateTag('base');
    this.cache.invalidateTag('products'); // نام دسته در DTO آگهی join می‌شود
    this.cache.invalidateTag('buy-requests');
  }

  /** ابطال کش‌های مکان + لیست‌های کش‌شده آگهی (نام مکان join است) */
  private invalidateLocationCaches(): void {
    this.cache.invalidateTag('locations');
    this.cache.invalidateTag('base');
    this.cache.invalidateTag('products');
    this.cache.invalidateTag('buy-requests');
  }
}
