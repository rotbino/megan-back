import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';
import { CategoriesService } from '../categories/categories.service';
import { LocationsService } from '../locations/locations.service';
import { CallsService, dailyCallLimit } from '../calls/calls.service';
import { SecurityService } from '../security/security.service';
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
  /** استان/شهر خام (خواستهٔ مالک ۷-۱۱) — برای فرمول تطابق فرانت
   *  (مقایسهٔ عددی دقیق‌تر از نام است؛ نام فقط نمایش) */
  provinceId: number | null;
  cityId: number | null;
  province: string | null;
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
  tier: 'exact' | 'same-product' | 'near-category' | 'other';
  relatedProduct: string;
}

/**
 * نام‌های join‌شده برای نمایش — رکورد BuyRequest فقط شناسه دارد؛
 * نام دسته/شهر و مشخصات خریدار در لحظه خواندن ساخته می‌شوند.
 */
interface NameMaps {
  users: Map<string, { firstName: string; lastName: string; isVerified: boolean }>;
  cats: Map<number, string>;
  provinces: Map<number, string>;
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
    private readonly calls: CallsService,
    private readonly security: SecurityService,
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
    // فیلتر درختی دسته — تب دوم صفحه خریداران (خود دسته + زیر‌شاخه‌ها)
    if (dto.categoryId != null) {
      const subtree = await this.categories.getSubtreeIds(dto.categoryId);
      where.categoryId = { in: subtree.length > 0 ? subtree : [-1] };
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
   *  فقط با بسته فعال (۱/۲/۳) اطلاعات تماس آشکار می‌شود.
   *
   *  امنیت ۱-۱۱: این هم سرویس اختصاصی آشکارسازی شماره است — سهمیهٔ روزانهٔ
   *  مشترک (رایگان ۱۰ / بستهٔ فعال ۳۰ کاربر در روز) با سرویس شمارهٔ فروشندگان،
   *  تلاش‌ها در سرویس امنیت شمرده می‌شوند و آشکارسازی در گزارش تماس‌های
   *  ادمین هم ثبت می‌شود (source=buyer_request). */
  async getBuyRequestContact(user: AuthUser, id: number, ip?: string) {
    const row = await this.prisma.buyRequest.findUnique({
      where: { id },
      select: { status: true, userId: true },
    });
    if (!row || row.status !== 'confirmed') {
      throw AppError.notFound('درخواست خرید یافت نشد.');
    }

    // خودِ خریدار بدون بسته هم شماره خودش را می‌بیند
    if (row.userId !== user.id) {
      // گیت ثبت کالا (خواستهٔ مالک ۷-۱۱): دیدن درخواست‌های خرید آزاد است، اما
      // تماس فقط برای فروشنده‌ای که کالای خود را برای فروش ثبت کرده — این
      // گیت قبل از گیت بسته می‌آید تا اولین قدم فروشنده ثبت کالا باشد
      const productCount = await this.prisma.product.count({
        where: { userId: user.id, status: { in: ['pending', 'confirmed'] } },
      });
      if (productCount === 0) {
        throw AppError.forbidden(
          'برای ارسال تامین یا تماس یا پیام، باید کالاهای خود را برای فروش ثبت کنید تا خریداران مرتبط به شما نمایش داده شوند.',
          'PRODUCT_REGISTRATION_REQUIRED',
        );
      }
      const me = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { activePakageType: true, packageExpiresAt: true },
      });
      const myPakage = effectivePakageType(me?.activePakageType ?? 0, me?.packageExpiresAt);
      if (myPakage === 0) {
        throw AppError.forbidden(
          'مشاهده اطلاعات تماس خریداران ویژه بسته اشتراک فعال دارد — برای دسترسی نامحدود به همه خریداران، یکی از بسته‌های ایمچ را فعال کنید.',
          'PACKAGE_REQUIRED',
        );
      }
      // ردپای امنیتی + گیت سهمیهٔ روزانهٔ مشترک تماس‌ها
      await this.security.noteContactReveal(user.id, ip, dailyCallLimit(myPakage));
      await this.calls.assertDailyQuota(user, row.userId, myPakage);
    }

    const buyer = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { phone: true, firstName: true, lastName: true, isVerified: true, allowCalls: true },
    });
    if (!buyer) throw AppError.notFound('خریدار یافت نشد.');

    // امکان تماس خاموش (خواسته مالک ۴-۱۱) — فقط چت؛ خودِ خریدار معاف است
    if (buyer.allowCalls === false && row.userId !== user.id) {
      throw AppError.forbidden(
        'این کاربر امکان تماس را غیرفعال کرده است؛ می‌توانید از گفتگوی چت استفاده کنید.',
        'CALLS_DISABLED',
      );
    }

    // ثبت آشکارسازی به‌عنوان تماس — گزارش ادمین + شمارش سهمیهٔ فردا درست بماند
    if (row.userId !== user.id) {
      await this.calls
        .reportCall(user, { calleeId: row.userId, source: 'buyer_request' })
        .catch(() => undefined);
    }

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
   * POST /buy-requests/getSuggestedBuyers — فرمول تطابق انعطاف‌پذیر (بازنویسی
   * خواستهٔ مالک ۷-۱۱). امتیاز ۰ تا ۱۰۰ از چهار محور:
   *   • کالا ۴۰ — هم‌برگ ۴۰ / هم‌پدر ۲۲ / هم‌ریشه ۱۰ (ستون فقرات؛ بدون آن
   *     محورهای دیگر اثر ندارند)
   *   • نوع کالا ۲۰ — تطبیق متن نوعِ درخواست با نام/نوع آگهی؛ درخواستِ بدون
   *     نوع یعنی «هر نوعی از همین کالا» و امتیاز کامل می‌گیرد
   *   • حجم خرید ۲۵ — بازهٔ معاملهٔ ممکن: حداقل سفارش فروشنده ≤ نیاز خریدار ≤
   *     موجودی؛ داخل بازه هرچه سهم بیشتری از عرضه بردارد به‌صرفه‌تر (تا ۲۵)،
   *     خارج بازه با نسبت فاصله کمرنگ می‌شود — «حجم خرید نزدیک». واحد وزنی
   *     نرمال می‌شود (تن ← کیلوگرم)؛ واحد غیرقابل‌مقایسه = امتیاز بی‌طرف ۱۰
   *   • مکان ۱۵ — هم‌شهر ۱۵ / هم‌استان ۱۰ (حمل ارزان‌تر = به‌صرفه‌تر)
   * هرگز خالی نمی‌شود (خواستهٔ مالک ۷-۱۱): اگر تطابق خاصی پیدا نشد، همان
   * خریداران موجود با امتیاز ۰ مرتب بر اساس تازگی نمایش داده می‌شوند.
   * گیت بسته حذف شد — دیدن خریداران آزاد است؛ گیت فقط سر ارسال تامین/تماس
   * است (assertSellerHasProduct و getBuyRequestContact).
   */
  async getSuggestedBuyers(userId: string): Promise<SuggestedBuyerDto[]> {
    const products = await this.prisma.product.findMany({
      where: { userId, status: { in: ['pending', 'confirmed'] } },
      select: {
        productName: true,
        subCategoryId: true,
        stock: true,
        minSaleAmount: true,
        provinceId: true,
        cityId: true,
        unit: true,
      },
      take: 50,
    });

    const requests = await this.prisma.buyRequest.findMany({
      where: { status: 'confirmed', user: { isActive: true } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const names = await this.hydrateNames(requests);

    // والد/ریشهٔ هر دسته از درخت کش‌شده — برای سطوح هم‌پدر/هم‌ریشه
    const all = await this.categories.getAllCategories();
    const flat = new Map<number, { parent: number | null }>();
    const walk = (nodes: Array<{ id: number; parent_id: number | null; children: unknown[] }>): void => {
      for (const n of nodes) {
        flat.set(n.id, { parent: n.parent_id });
        walk(n.children as typeof nodes);
      }
    };
    walk(all as never);

    const out: SuggestedBuyerDto[] = [];
    for (const req of requests) {
      if (req.userId === userId) continue; // درخواست خودم
      let best = 0;
      let tier: SuggestedBuyerDto['tier'] = 'other';
      let related = '';
      for (const product of products) {
        const m = this.scoreRequestMatch(product, req, flat);
        if (m.score > best) {
          best = m.score;
          tier = m.tier;
          related = product.productName;
        }
      }
      // ثبت همهٔ درخواست‌ها — حتی بی‌تطابق (هرگز خالی نمی‌شود)؛ درخواست‌های
      // تازه بالای بقیهٔ بی‌تطابق‌ها می‌مانند چون از ابتدا بر اساس createdAt
      // desc آمده‌اند و مرتب‌سازی پایین پایدار است
      out.push({
        buyRequest: this.toDto(req, names),
        matchScore: Math.round(best),
        tier,
        relatedProduct: related,
      });
    }

    return out.sort((a, b) => b.matchScore - a.matchScore).slice(0, 24);
  }

  /** امتیاز یک جفت (آگهی خودم، درخواست خرید) — فرمول چهارمحوری مالک ۷-۱۱ */
  private scoreRequestMatch(
    product: {
      productName: string;
      subCategoryId: number;
      stock: number;
      minSaleAmount: number;
      provinceId: number;
      cityId: number;
      unit: string;
    },
    req: {
      name: string | null;
      categoryId: number;
      requirementAmount: number;
      unit: string;
      provinceId: number | null;
      cityId: number | null;
    },
    flat: Map<number, { parent: number | null }>,
  ): { score: number; tier: SuggestedBuyerDto['tier'] } {
    // ── کالا — ستون فقرات ──
    const ancestorsOf = (id: number): Set<number> => {
      const set = new Set<number>();
      let cur = flat.get(id)?.parent ?? null;
      while (cur != null && !set.has(cur)) {
        set.add(cur);
        cur = flat.get(cur)?.parent ?? null;
      }
      return set;
    };
    const sameLeaf = req.categoryId === product.subCategoryId;
    const reqParent = flat.get(req.categoryId)?.parent ?? null;
    const prodParent = flat.get(product.subCategoryId)?.parent ?? null;
    const sameParent = reqParent != null && reqParent === prodParent;
    const sameRoot =
      !sameParent &&
      [...ancestorsOf(req.categoryId)].some((a) => ancestorsOf(product.subCategoryId).has(a));
    const catScore = sameLeaf ? 40 : sameParent ? 22 : sameRoot ? 10 : 0;
    if (catScore === 0) return { score: 0, tier: 'other' };

    // ── نوع کالا — تطبیق متن دوطرفه ──
    const norm = (s: string) => s.replace(/[\u200c\s]+/g, ' ').trim();
    const t = req.name ? norm(req.name) : '';
    const p = norm(product.productName);
    const typeScore = !t || p.includes(t) || t.includes(p) ? 20 : 0;

    // ── حجم خرید — بازهٔ معاملهٔ ممکن + نزدیکی ──
    const volScore = this.volumeScore(
      req.requirementAmount,
      req.unit,
      product.stock,
      Math.max(1, product.minSaleAmount),
      product.unit,
    );

    // ── مکان — هم‌شهر/هم‌استان ──
    const locScore =
      req.cityId != null && req.cityId === product.cityId
        ? 15
        : req.provinceId != null && req.provinceId === product.provinceId
          ? 10
          : 0;

    const tier: SuggestedBuyerDto['tier'] = sameLeaf
      ? t && typeScore > 0
        ? 'exact'
        : 'same-product'
      : 'near-category';

    return { score: catScore + typeScore + volScore + locScore, tier };
  }

  /**
   * امتیاز حجم (۰ تا ۲۵) — «حجم خرید نزدیک» (خواستهٔ مالک ۷-۱۱):
   *  • نیاز خریدار داخل بازهٔ [حداقل سفارش فروشنده، موجودی فروشنده] → معامله
   *    ممکن؛ هرچه سهم بیشتری از عرضه بردارد به‌صرفه‌تر: ۱۸ + ۷×سهم
   *  • زیر حداقل سفارش → با نسبت نزدیکی به حداقل کمرنگ می‌شود
   *  • بالای موجودی → با نسبت پوشش موجودی کمرنگ می‌شود
   *  • واحد غیرقابل‌مقایسه (مثل عدد در برابر کیلوگرم) → بی‌طرف ۱۰
   */
  private volumeScore(
    buyerAmount: number,
    buyerUnit: string,
    sellerStock: number,
    sellerMin: number,
    sellerUnit: string,
  ): number {
    const FAMILY: Record<string, string> = {
      'تن': 'weight',
      'کیلوگرم': 'weight',
      'گرم': 'weight',
      'عدد': 'count',
      'بسته': 'pack',
      'متر': 'length',
      'لیتر': 'volume',
    };
    const parse = (v: number, unit: string): { v: number; f: string } | null => {
      const f = FAMILY[unit];
      if (!f) return null;
      if (unit === 'تن') return { v: v * 1000, f };
      if (unit === 'گرم') return { v: v / 1000, f };
      return { v, f };
    };
    const buyer = parse(buyerAmount, buyerUnit);
    const stock = parse(Math.max(1, sellerStock), sellerUnit);
    const min = parse(sellerMin, sellerUnit);
    if (!buyer || !stock || !min || buyer.f !== stock.f) return 10; // غیرقابل‌مقایسه — بی‌طرف

    if (buyer.v >= min.v && buyer.v <= Math.max(min.v, stock.v)) {
      // داخل بازهٔ معامله — خرید بزرگ‌تر از عرضهٔ فروشنده به‌صرفه‌تر
      return 18 + 7 * Math.min(1, buyer.v / stock.v);
    }
    if (buyer.v < min.v) return 25 * (buyer.v / min.v) * 0.8; // زیر حداقل سفارش فروشنده
    return 25 * (stock.v / buyer.v) * 0.8; // بیش از موجودی فروشنده
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
  private async hydrateNames(
    rows: Array<{
      userId: string;
      categoryId: number;
      provinceId: number | null;
      cityId: number | null;
    }>,
  ): Promise<NameMaps> {
    if (rows.length === 0) {
      return { users: new Map(), cats: new Map(), provinces: new Map(), cities: new Map() };
    }
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const provinceIds = [...new Set(rows.map((r) => r.provinceId).filter((p): p is number => p != null))];
    const cityIds = [...new Set(rows.map((r) => r.cityId).filter((c): c is number => c != null))];
    const catIds = [...new Set(rows.map((r) => r.categoryId))];

    const [userRows, catMap, locNames] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, isVerified: true },
      }),
      this.categories.getNameMap(), // کش‌شده
      this.locations.getNames(provinceIds, cityIds),
    ]);

    return {
      users: new Map(
        userRows.map((u) => [u.id, { firstName: u.firstName, lastName: u.lastName, isVerified: u.isVerified }]),
      ),
      cats: new Map(catIds.map((id) => [id, catMap.get(id)?.category_name ?? '—'])),
      provinces: locNames.provinces,
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
      provinceId: number | null;
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
      provinceId: r.provinceId ?? null,
      cityId: r.cityId ?? null,
      province: (r.provinceId != null ? names.provinces.get(r.provinceId) : undefined) ?? null,
      isVerified: buyer?.isVerified ?? false,
      createdAt: r.createdAt,
    };
  }
}
