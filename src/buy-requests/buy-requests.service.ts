import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';
import { CategoriesService } from '../categories/categories.service';
import { LocationsService } from '../locations/locations.service';
import { effectivePakageType } from '../packages/packages.service';
import type { AuthUser } from '../common/guards';
import {
  CreateBuyRequestDto,
  GetBuyRequestListDto,
  GetMyBuyRequestsDto,
  ReviewBuyRequestDto,
  UpdateMyBuyRequestDto,
} from './dto';

/** شروع id انواع کالا (Good) — بالاتر از کل idهای باسکول (~۱۰۳۵) */
const GOOD_START_ID = 900_000;

const BUY_REQUEST_PAGE = 12; // عین صفحه‌بندی باسکول

/** DTO کارت لیست عمومی — هم‌شکل تایپ BuyRequest فرانت (عین get_buyAd_list) */
export interface BuyRequestDto {
  id: number;
  name: string | null;
  categoryId: number;
  subcategoryName: string;
  requirementAmount: number;
  unit: string;
  /** ObjectId مگان (رشته) — در باسکول عدد بود؛ فقط کلید/ارجاع فرانت */
  myuserId: string;
  firstName: string;
  lastName: string;
  city: string;
  isVerified: boolean;
  createdAt: Date;
}

/** DTO «درخواستهای من» — تب‌های پنل خریدار */
export interface MyBuyRequestDto {
  id: number;
  subcategoryName: string;
  productType: string;
  requirementAmount: number;
  unit: string;
  status: string;
  goal: 'price_and_buy' | 'price_only';
  hasHistory: boolean;
  createdAt: Date;
  /** دلایل رد — فقط رد شده (باگ ۲۸-۱۰: به پنل کاربر نمی‌رسید) */
  rejectionReasons: string[];
}

/** خریدار پیشنهادی برای فروشنده — منطبق تایپ SuggestedBuyer فرانت */
export interface SuggestedBuyerDto {
  buyRequest: BuyRequestDto;
  matchScore: number;
  tier: 'exact' | 'same-product' | 'near-category';
  relatedProduct: string;
}

/**
 * نام‌های join‌شده برای نمایش — رکورد BuyRequest فقط شناسه دارد؛
 * نام دسته/شهر و مشخصات خریدار در لحظه خواندن ساخته می‌شوند.
 */
interface NameMaps {
  users: Map<string, { firstName: string; lastName: string; isVerified: boolean }>;
  cats: Map<number, string>;
  cities: Map<number, string>;
}

/**
 * ─── درخواست‌های خرید (RFQ) — B7 ─────────────────────────────────────────────
 * ساختار عین باسکول: جمله کارت «خریدار {مقدار} {واحد} {دسته} از نوع {نوع} هستم».
 * «نوع کالا» هنگام ثبت به ردیف جدول Good تبدیل می‌شود (جداشده از درخت دسته،
 * خواسته مالک ۳۰-۱۰) — زیربنای تطبیق درخواست با فروشندگان همان نوع.
 */
@Injectable()
export class BuyRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly categories: CategoriesService,
    private readonly locations: LocationsService,
  ) {}

  // ─── ثبت درخواست ───────────────────────────────────────────────────────────

  /** POST /buy-requests/createBuyRequest → «در انتظار تایید» */
  async createBuyRequest(user: AuthUser, dto: CreateBuyRequestDto) {
    // انتخاب‌گرهای فرانت تا دسته برگ پایین می‌روند؛ نوع کالا (Good) جدول جدا
    // دارد و هرگز نود درخت نیست (خواسته مالک ۳۰-۱۰) — فقط وجود دسته چک می‌شود.
    const sub = await this.categories.getCategoryById(dto.subCategoryId);
    if (!sub) throw AppError.badRequest('دسته انتخابی معتبر نیست.', 'BAD_CATEGORY');
    const typeName = dto.name?.trim();

    // مکان — اختیاری مثل باسکول (خریدار می‌تواند «همه ایران» بماند)
    if (dto.provinceId || dto.cityId) {
      if (!dto.provinceId || !dto.cityId) {
        throw AppError.badRequest('استان و شهر را کامل انتخاب کنید.', 'CITY_REQUIRED');
      }
      const city = await this.locations.getCityById(dto.cityId);
      if (!city) throw AppError.badRequest('شهر انتخابی معتبر نیست.', 'BAD_CITY');
      if (city.province_id !== dto.provinceId) {
        throw AppError.badRequest('شهر به استان انتخابی تعلق ندارد.', 'CITY_PROVINCE_MISMATCH');
      }
      const province = await this.locations.getProvinceById(dto.provinceId);
      if (!province) throw AppError.badRequest('استان انتخابی معتبر نیست.', 'BAD_PROVINCE');
      if (city.is_active === false || province.is_active === false) {
        throw AppError.badRequest('مکان انتخابی فعلاً غیرفعال است.', 'INACTIVE_LOCATION');
      }
    }

    // «نوع کالا» → ردیف Good جداشده از دسته‌ها (idempotent)
    let goodId: number | null = null;
    if (typeName) {
      goodId = await this.upsertGood(sub.id, typeName, user.id);
    }

    const id = await this.nextId();
    // رکورد نرمال — فقط شناسه‌ها؛ نام‌ها هنگام خواندن join می‌شوند
    const row = await this.prisma.buyRequest.create({
      data: {
        id,
        name: typeName || null,
        description: dto.description?.trim() || null,
        categoryId: sub.id,
        goodId,
        requirementAmount: dto.requirementAmount,
        unit: sub.unit || 'کیلوگرم',
        provinceId: dto.provinceId ?? null,
        cityId: dto.cityId ?? null,
        goal: dto.goal ?? 'price_and_buy',
        hasHistory: dto.hasHistory ?? false,
        status: 'pending',
        userId: user.id,
      },
    });
    this.cache.invalidateTag('buy-requests');
    return { id: row.id, status: row.status };
  }

  /**
   * نوع کالا (Good) — «نوع {دسته} خود را وارد کنید» باسکول:
   * نوع موجود (همان دسته با همین نام) بازمصرف می‌شود؛ در غیر این صورت با id
   * از Counter('good') ساخته می‌شود. جدول Category دست نمی‌خورد — نوع کالا
   * دیگر نود درخت نیست و در سایدبار دیده نمی‌شود (خواسته مالک ۳۰-۱۰).
   */
  private async upsertGood(
    categoryId: number,
    name: string,
    createdById: string,
  ): Promise<number> {
    const existing = await this.prisma.good.findUnique({
      where: { categoryId_name: { categoryId, name } },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.good.update({
        where: { id: existing.id },
        data: { usageCount: { increment: 1 } },
      });
      return existing.id;
    }

    const counter = await this.prisma.counter.upsert({
      where: { id: 'good' },
      create: { id: 'good', seq: GOOD_START_ID },
      update: { seq: { increment: 1 } },
    });
    const good = await this.prisma.good.create({
      data: {
        id: counter.seq,
        categoryId,
        name,
        createdById,
        usageCount: 1,
      },
    });
    return good.id;
  }

  // ─── لیست عمومی ────────────────────────────────────────────────────────────

  /** POST /buy-requests/getBuyRequestList — فقط confirmed (عین باسکول) */
  async getBuyRequestList(dto: GetBuyRequestListDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? BUY_REQUEST_PAGE));

    const where: Record<string, unknown> = { status: 'confirmed', user: { isActive: true } };
    if (dto.s?.trim()) {
      // جستجو در «نوع کالا» + نام دسته (resolve از درخت کش‌شده — بدون ستون denorm)
      const q = dto.s.trim();
      const catIds = await this.categories.searchCategoryIds(q);
      where.OR = [
        { name: { contains: q } },
        ...(catIds.length > 0 ? [{ categoryId: { in: catIds } }] : []),
      ];
    }
    if (dto.provinceId) where.provinceId = dto.provinceId;

    const [total, rows] = await Promise.all([
      this.prisma.buyRequest.count({ where }),
      this.prisma.buyRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);
    const names = await this.hydrateNames(rows);

    return {
      items: rows.map((r) => this.toDto(r, names)),
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  /** POST /buy-requests/getLatestBuyRequests — سکشن صفحه اول (۴ تایی عین باسکول) */
  async getLatestBuyRequests(limit = 4) {
    const rows = await this.prisma.buyRequest.findMany({
      where: { status: 'confirmed', user: { isActive: true } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(12, Math.max(1, limit)),
    });
    const names = await this.hydrateNames(rows);
    return rows.map((r) => this.toDto(r, names));
  }

  /** POST /buy-requests/getBuyRequestContact — شماره خریدار (لاگین لازم).
   *  گیت بسته (خواسته مالک): بسته رایگان شماره خریداران را نمی‌بیند —
   *  فقط با بسته فعال (۱/۲/۳) اطلاعات تماس آشکار می‌شود. */
  async getBuyRequestContact(user: AuthUser, id: number) {
    const row = await this.prisma.buyRequest.findUnique({
      where: { id },
      select: { status: true, userId: true },
    });
    if (!row || row.status !== 'confirmed') {
      throw AppError.notFound('درخواست خرید یافت نشد.');
    }

    // خودِ خریدار بدون بسته هم شماره خودش را می‌بیند
    if (row.userId !== user.id) {
      const me = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { activePakageType: true, packageExpiresAt: true },
      });
      if (effectivePakageType(me?.activePakageType ?? 0, me?.packageExpiresAt) === 0) {
        throw AppError.forbidden(
          'مشاهده اطلاعات تماس خریداران ویژه بسته اشتراک فعال دارد — برای دسترسی نامحدود به همه خریداران، یکی از بسته‌های ایمچ را فعال کنید.',
          'PACKAGE_REQUIRED',
        );
      }
    }

    const buyer = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { phone: true, firstName: true, lastName: true, isVerified: true },
    });
    if (!buyer) throw AppError.notFound('خریدار یافت نشد.');
    return {
      phone: buyer.phone,
      firstName: buyer.firstName,
      lastName: buyer.lastName,
      isVerified: buyer.isVerified,
      // خریدار خودش است — بدون آشکارسازی
      isSelf: row.userId === user.id,
    };
  }

  // ─── درخواستهای من ─────────────────────────────────────────────────────────

  /** POST /buy-requests/getMyBuyRequests — تب‌های پنل خریدار */
  async getMyBuyRequests(userId: string, dto: GetMyBuyRequestsDto) {
    const [rows, counts] = await Promise.all([
      this.prisma.buyRequest.findMany({
        where: {
          userId,
          ...(dto.status ? { status: dto.status } : { status: { not: 'deleted' } }),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.buyRequest.groupBy({
        by: ['status'],
        where: { userId },
        _count: { id: true },
      }),
    ]);
    const countMap: Record<string, number> = { confirmed: 0, pending: 0, rejected: 0 };
    for (const g of counts) countMap[g.status] = g._count.id;

    // نام دسته از درخت کش‌شده (denorm حذف شده)
    const catMap = await this.categories.getNameMap();

    return {
      items: rows.map(
        (r): MyBuyRequestDto => ({
          id: r.id,
          subcategoryName: catMap.get(r.categoryId)?.category_name ?? '—',
          productType: r.name ?? '',
          requirementAmount: r.requirementAmount,
          unit: r.unit,
          status: r.status,
          goal: (r.goal as MyBuyRequestDto['goal']) ?? 'price_and_buy',
          hasHistory: r.hasHistory,
          createdAt: r.createdAt,
          rejectionReasons: r.rejectionReason ? [r.rejectionReason] : [],
        }),
      ),
      counts: countMap,
    };
  }

  /** POST /buy-requests/deleteMyBuyRequest — حذف نرم */
  async deleteMyBuyRequest(user: AuthUser, id: number) {
    const row = await this.prisma.buyRequest.findUnique({ where: { id } });
    if (!row || row.userId !== user.id) {
      throw AppError.notFound('درخواست خرید یافت نشد.');
    }
    await this.prisma.buyRequest.update({ where: { id }, data: { status: 'deleted' } });
    // شمارنده استفاده نوع کالا — best-effort؛ خطا نباید حذف را خراب کند
    if (row.goodId != null) {
      await this.prisma.good
        .update({ where: { id: row.goodId }, data: { usageCount: { decrement: 1 } } })
        .catch(() => undefined);
    }
    this.cache.invalidateTag('buy-requests');
    return { ok: true as const };
  }

  /**
   * POST /buy-requests/updateMyBuyRequest — ویرایش درخواست «در انتظار تایید».
   * فقط مالک و فقط pending (بعد از تأیید/رد، مثل باسکول قابل ویرایش نیست)؛
   * تغییر «نوع کالا» → ردیف Good تازه (idempotent). مکان اختیاری است.
   */
  async updateMyBuyRequest(user: AuthUser, dto: UpdateMyBuyRequestDto) {
    const row = await this.prisma.buyRequest.findUnique({ where: { id: dto.id } });
    if (!row || row.userId !== user.id) {
      throw AppError.notFound('درخواست خرید یافت نشد.');
    }
    if (row.status !== 'pending') {
      throw AppError.badRequest(
        'فقط درخواست‌های «در انتظار تایید» قابل ویرایش هستند.',
        'NOT_EDITABLE',
      );
    }

    // اعتبار مکان — مثل ثبت جدید (هر دو یا هیچ‌کدام)
    if (dto.provinceId || dto.cityId) {
      if (!dto.provinceId || !dto.cityId) {
        throw AppError.badRequest('استان و شهر را کامل انتخاب کنید.', 'CITY_REQUIRED');
      }
      const city = await this.locations.getCityById(dto.cityId);
      if (!city) throw AppError.badRequest('شهر انتخابی معتبر نیست.', 'BAD_CITY');
      if (city.province_id !== dto.provinceId) {
        throw AppError.badRequest('شهر به استان انتخابی تعلق ندارد.', 'CITY_PROVINCE_MISMATCH');
      }
    }

    // «نوع کالا» عوض شده → ردیف Good تازه (idempotent)؛ خالی = بدون تغییر می‌ماند
    let goodId = row.goodId;
    if (dto.name !== undefined && dto.name.trim() && dto.name.trim() !== row.name) {
      goodId = await this.upsertGood(row.categoryId, dto.name.trim(), user.id);
    }

    const updated = await this.prisma.buyRequest.update({
      where: { id: dto.id },
      data: {
        name: dto.name !== undefined ? dto.name.trim() || null : row.name,
        description: dto.description !== undefined ? dto.description.trim() || null : row.description,
        goodId,
        requirementAmount: dto.requirementAmount,
        goal: dto.goal ?? (row.goal as 'price_and_buy' | 'price_only'),
        provinceId: dto.provinceId ?? row.provinceId,
        cityId: dto.cityId ?? row.cityId,
      },
    });
    this.cache.invalidateTag('buy-requests');
    return { id: updated.id, status: updated.status };
  }

  // ─── خریداران پیشنهادی (تطبیق آگهی‌های من) ─────────────────────────────────

  /**
   * POST /buy-requests/getSuggestedBuyers — سه سطح تطبیق عین پنل باسکول:
   *   exact: نوع کالای درخواست = نام/نوع همان آگهی من
   *   same-product: همان دسته برگ
   *   near-category: دسته خواهر (هم‌پدر)
   * امتیاز حجم: نزدیکی requirementAmount به موجودی آگهی (منطق «حجم خرید نزدیک
   * حجم فروش» باسکول) — امتیاز تطابق از ۱۰۰.
   */
  async getSuggestedBuyers(userId: string): Promise<SuggestedBuyerDto[]> {
    // گیت بسته — خریداران پیشنهادی هم مثل صفحه خریداران ویژه بسته فعال است
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { activePakageType: true, packageExpiresAt: true },
    });
    if (effectivePakageType(me?.activePakageType ?? 0, me?.packageExpiresAt) === 0) {
      return [];
    }

    const products = await this.prisma.product.findMany({
      where: { userId, status: 'confirmed' },
      select: { id: true, productName: true, subCategoryId: true, stock: true },
      take: 50,
    });
    if (products.length === 0) return [];

    // دسته‌های پدر برای تشخیص «دسته خواهر» + نام‌ها برای join
    const all = await this.categories.getAllCategories();
    const flat = new Map<number, { parent: number | null }>();
    const walk = (nodes: Array<{ id: number; parent_id: number | null; children: unknown[] }>): void => {
      for (const n of nodes) {
        flat.set(n.id, { parent: n.parent_id });
        walk(n.children as typeof nodes);
      }
    };
    walk(all as never);

    const requests = await this.prisma.buyRequest.findMany({
      where: { status: 'confirmed' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const names = await this.hydrateNames(requests);

    const out: SuggestedBuyerDto[] = [];
    const seen = new Set<number>(); // یک درخواست فقط یک‌بار (بهترین تطبیق)
    for (const product of products) {
      const pName = product.productName.replace(/\s+/g, ' ').trim();
      for (const req of requests) {
        if (seen.has(req.id)) continue;
        if (req.userId === userId) continue; // درخواست خودم

        let tier: SuggestedBuyerDto['tier'] | null = null;
        if (req.categoryId === product.subCategoryId && req.name && pName.includes(req.name.trim())) {
          tier = 'exact';
        } else if (req.categoryId === product.subCategoryId) {
          tier = 'same-product';
        } else {
          const reqParent = flat.get(req.categoryId)?.parent ?? null;
          const prodParent = flat.get(product.subCategoryId)?.parent ?? null;
          if (reqParent != null && reqParent === prodParent) tier = 'near-category';
        }
        if (!tier) continue;

        // امتیاز حجم — نزدیکی نیازمندی خریدار به موجودی من
        const stock = Math.max(1, product.stock);
        const ratio = req.requirementAmount / stock;
        const volumeScore =
          ratio >= 0.5 && ratio <= 2 ? 30 : Math.max(0, 30 - Math.abs(Math.log(ratio)) * 15);
        const base = tier === 'exact' ? 70 : tier === 'same-product' ? 50 : 25;

        out.push({
          buyRequest: this.toDto(req, names),
          matchScore: Math.min(99, Math.round(base + volumeScore)),
          tier,
          relatedProduct: product.productName,
        });
        if (tier === 'exact') seen.add(req.id); // تطابق کامل → از ادامه خارج
      }
    }
    // بهترین امتیاز برای درخواست‌های تکراری (same/near چند آگهی)
    const best = new Map<number, SuggestedBuyerDto>();
    for (const item of out) {
      const cur = best.get(item.buyRequest.id);
      if (!cur || item.matchScore > cur.matchScore) best.set(item.buyRequest.id, item);
    }
    return [...best.values()].sort((a, b) => b.matchScore - a.matchScore).slice(0, 24);
  }

  /**
   * POST /buy-requests/getSuggestedSellers — فروشندگان پیشنهادی پنل خریدار:
   * گروه دسته‌ای بر اساس درخواست‌های خرید confirmed خودم؛ برای هر دسته،
   * تعداد فروشندگان متمایزی که آگهی confirmed همان دسته (برگ یا پدر) دارند.
   * کلیک گروه → لیست محصولات همان دسته.
   */
  async getSuggestedSellers(userId: string): Promise<
    Array<{ id: number; categoryName: string; sellerCount: number; href: string }>
  > {
    const myRequests = await this.prisma.buyRequest.findMany({
      where: { userId, status: 'confirmed' },
      select: { categoryId: true },
      take: 100,
    });
    if (myRequests.length === 0) return [];
    const catIds = [...new Set(myRequests.map((r) => r.categoryId))];

    const products = await this.prisma.product.findMany({
      where: {
        status: 'confirmed',
        OR: [{ subCategoryId: { in: catIds } }, { categoryId: { in: catIds } }],
      },
      select: { userId: true, subCategoryId: true, categoryId: true },
      take: 3000,
    });
    if (products.length === 0) return [];

    // شمار فروشنده متمایز هر دسته درخواستی
    const sellersByCat = new Map<number, Set<string>>();
    for (const p of products) {
      for (const cid of catIds) {
        if (p.subCategoryId === cid || p.categoryId === cid) {
          if (!sellersByCat.has(cid)) sellersByCat.set(cid, new Set());
          sellersByCat.get(cid)!.add(p.userId);
        }
      }
    }

    // نام و slug دسته از درخت کش‌شده
    const tree = await this.categories.getAllCategories();
    const catInfo = new Map<number, { name: string; slug: string }>();
    const walk = (nodes: Array<{ id: number; category_name: string; slug: string; children: unknown[] }>): void => {
      for (const n of nodes) {
        catInfo.set(n.id, { name: n.category_name, slug: n.slug });
        walk(n.children as typeof nodes);
      }
    };
    walk(tree as never);

    const out: Array<{ id: number; categoryName: string; sellerCount: number; href: string }> = [];
    for (const cid of catIds) {
      const sellers = sellersByCat.get(cid);
      if (!sellers || sellers.size === 0) continue;
      const info = catInfo.get(cid);
      out.push({
        id: cid,
        categoryName: info?.name ?? '—',
        sellerCount: sellers.size,
        href: `/product-list/category/${encodeURIComponent(info?.slug ?? String(cid))}`,
      });
    }
    return out.sort((a, b) => b.sellerCount - a.sellerCount).slice(0, 12);
  }

  // ─── ادمین ─────────────────────────────────────────────────────────────────

  /** POST /buy-requests/reviewBuyRequest (ادمین) — تأیید/رد درخواست */
  async reviewBuyRequest(dto: ReviewBuyRequestDto) {
    const row = await this.prisma.buyRequest.findUnique({ where: { id: dto.id } });
    if (!row) throw AppError.notFound('درخواست خرید یافت نشد.');
    if (row.status !== 'pending') {
      throw AppError.conflict('این درخواست قبلاً بررسی شده است.', 'ALREADY_REVIEWED');
    }
    const reason = dto.rejectionReason?.trim();
    if (!dto.approve && !reason) {
      throw AppError.badRequest('دلیل رد شدن را وارد کنید.', 'REASON_REQUIRED');
    }
    const updated = await this.prisma.buyRequest.update({
      where: { id: dto.id },
      data: dto.approve
        ? { status: 'confirmed' }
        : { status: 'rejected', rejectionReason: reason },
    });
    this.cache.invalidateTag('buy-requests');
    return { id: updated.id, status: updated.status };
  }

  // ─── داخلی ─────────────────────────────────────────────────────────────────

  /** id عددی افزایشی — increment اتمیک روی Counter */
  private async nextId(): Promise<number> {
    const counter = await this.prisma.counter.upsert({
      where: { id: 'buy_request' },
      create: { id: 'buy_request', seq: 1_000_000 },
      update: { seq: { increment: 1 } },
    });
    return counter.seq;
  }

  /**
   * join نام‌ها برای نمایش — کاربران/شهرها کوئری دسته‌ای + درخت کش‌شده دسته‌ها.
   */
  private async hydrateNames(rows: Array<{ userId: string; categoryId: number; cityId: number | null }>): Promise<NameMaps> {
    if (rows.length === 0) {
      return { users: new Map(), cats: new Map(), cities: new Map() };
    }
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const cityIds = [...new Set(rows.map((r) => r.cityId).filter((c): c is number => c != null))];
    const catIds = [...new Set(rows.map((r) => r.categoryId))];

    const [userRows, catMap, locNames] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, isVerified: true },
      }),
      this.categories.getNameMap(), // کش‌شده
      this.locations.getNames([], cityIds),
    ]);

    return {
      users: new Map(
        userRows.map((u) => [u.id, { firstName: u.firstName, lastName: u.lastName, isVerified: u.isVerified }]),
      ),
      cats: new Map(catIds.map((id) => [id, catMap.get(id)?.category_name ?? '—'])),
      cities: locNames.cities,
    };
  }

  private toDto(
    r: {
      id: number;
      name: string | null;
      categoryId: number;
      requirementAmount: number;
      unit: string;
      userId: string;
      cityId: number | null;
      createdAt: Date;
    },
    names: NameMaps,
  ): BuyRequestDto {
    const buyer = names.users.get(r.userId);
    return {
      id: r.id,
      name: r.name,
      categoryId: r.categoryId,
      subcategoryName: names.cats.get(r.categoryId) ?? '—',
      requirementAmount: r.requirementAmount,
      unit: r.unit,
      myuserId: r.userId,
      firstName: buyer?.firstName ?? '—',
      lastName: buyer?.lastName ?? '—',
      city: (r.cityId != null ? names.cities.get(r.cityId) : undefined) ?? '—',
      isVerified: buyer?.isVerified ?? false,
      createdAt: r.createdAt,
    };
  }
}
