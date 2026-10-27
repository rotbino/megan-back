import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.module';
import { CacheService } from '../../common/cache/cache.module';
import { AppError } from '../../common/errors/app-error';
import { CategoriesService } from '../../categories/categories.service';
import { LocationsService } from '../../locations/locations.service';
import { UploadsService } from '../../uploads/uploads.service';
import { ProductsService } from '../../products/products.service';
import type {
  GetAdminProductListDto,
  ProductStatusKey,
  ReviewAdminProductDto,
  SetLadderDto,
  SetProductStatusDto,
} from './dto';

const OID_RE = /^[0-9a-fA-F]{24}$/;

/** ردیف جدول آگهی‌های ادمین — نام‌ها join، موبایل فروشنده برای تماس */
export interface AdminProductRow {
  id: number;
  product_name: string;
  status: ProductStatusKey;
  category_name: string;
  sub_category_name: string;
  province_name: string;
  city_name: string;
  seller: { id: string; user_name: string; phone: string; is_verified: boolean };
  stock: number;
  min_sale_amount: number;
  min_sale_price: number;
  unit: string;
  is_ladder: boolean;
  ladder_expires_at: Date | null;
  view_count: number;
  photo: string | null;
  rejection_reasons: string[];
  created_at: Date;
  updated_at: Date;
}

/** طول نردبان هدیه ادمین — هم‌قد خرید کاربر (۳۰ روز) */
const ADMIN_LADDER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * فاز A4 — مدیریت آگهی‌های پنل ادمین.
 *
 * مرزها (docs/ADMIN-IMPLEMENTATION.md §۱):
 *  • بازبینی (pending → confirmed/rejected) از سرویس دامنه
 *    ProductsService.reviewProduct با export مصرف می‌شود — کپی نمی‌شود.
 *  • تغییر وضعیت مستقیم/نردبان/حذف، عملیات مدیریتی خودِ ادمین است (A5 لاگ می‌شود).
 *  • پس از هر نوشتن، کش‌های تگ‌دار لیست‌های عمومی + `product:{id}` ابطال می‌شوند.
 */
@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly categories: CategoriesService,
    private readonly locations: LocationsService,
    private readonly uploads: UploadsService,
    private readonly products: ProductsService,
  ) {}

  // ─── لیست + جستجو + فیلتر ──────────────────────────────────────────────────

  /** POST /admin/products/getProductList — شمارنده‌های تب + ردیف‌های join‌شده */
  async getProductList(dto: GetAdminProductListDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));
    const s = (dto.search ?? '').trim();

    // پایه فیلترها — روی رکوردهای خود آگهی
    const base: Prisma.ProductWhereInput[] = [
      ...(dto.status ? [{ status: dto.status }] : []),
      ...(dto.provinceId ? [{ provinceId: dto.provinceId }] : []),
      ...(dto.cityId ? [{ cityId: dto.cityId }] : []),
      ...(dto.ladder !== undefined ? [{ isLadder: dto.ladder }] : []),
      ...(dto.sellerId && OID_RE.test(dto.sellerId) ? [{ userId: dto.sellerId }] : []),
    ];

    // فیلتر دسته — خودش + درخت فرزندان (subCategoryId یا categoryId)
    if (dto.categoryId) {
      const ids = await this.categories.getSubtreeIds(dto.categoryId);
      if (ids.length === 0) {
        return this.emptyList(page, perPage);
      }
      base.push({ OR: [{ subCategoryId: { in: ids } }, { categoryId: { in: ids } }] });
    }

    // جستجو — نام محصول + نام دسته (از درخت کش‌شده) + موبایل/نام‌کاربری فروشنده
    if (s) {
      const catIds = await this.categories.searchCategoryIds(s);
      const or: Prisma.ProductWhereInput[] = [
        { productName: { contains: s } },
        { user: { OR: [{ phone: { contains: s } }, { userName: { contains: s } }] } },
      ];
      if (catIds.length > 0) {
        or.push({ subCategoryId: { in: catIds } }, { categoryId: { in: catIds } });
      }
      base.push({ OR: or });
    }

    const where: Prisma.ProductWhereInput = base.length > 0 ? { AND: base } : {};

    // شمارنده تب‌ها — همیشه کل فضای جستجو/فیلترهای غیرِ وضعیت (بدون فیلتر status)
    const countsWhere = await this.statuslessWhere(dto, s);

    const [total, rows, byStatus] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.product.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: countsWhere,
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

  // ─── جزئیات کامل (شامل سفارش‌های نردبان — فقط خواندنی) ────────────────────

  /** POST /admin/products/getProductDetail — رکورد کامل + گالری + فروشنده + نردبان‌ها */
  async getProductDetail(id: number) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw AppError.notFound('آگهی یافت نشد.');

    const [rows, ladderOrders] = await Promise.all([
      this.toRows([p]),
      this.prisma.ladderOrder.findMany({
        where: { productId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, amount: true, startsAt: true, expiresAt: true, createdAt: true,
          userId: true,
        },
      }),
    ]);

    const seller = await this.prisma.user.findUnique({
      where: { id: p.userId },
      select: {
        id: true, phone: true, userName: true, firstName: true, lastName: true,
        isVerified: true, isActive: true, walletBalance: true,
      },
    });

    const features = Array.isArray(p.features)
      ? (p.features as Array<{ key: string; value: string }>)
      : [];

    return {
      ...rows[0],
      description: p.description,
      features,
      photos: await this.galleryUrls(id),
      seller: seller
        ? {
            id: seller.id,
            phone: seller.phone,
            user_name: seller.userName,
            first_name: seller.firstName,
            last_name: seller.lastName,
            is_verified: seller.isVerified,
            is_active: seller.isActive,
            wallet_balance: seller.walletBalance,
          }
        : null,
      /** سفارش‌های نردبان این آگهی — فقط خواندنی (amount=0 → هدیه ادمین) */
      ladder_orders: ladderOrders.map((o) => ({
        id: o.id,
        amount: o.amount,
        starts_at: o.startsAt,
        expires_at: o.expiresAt,
        created_at: o.createdAt,
        by_admin_gift: o.amount === 0,
      })),
    };
  }

  // ─── عملیات ────────────────────────────────────────────────────────────────

  /** POST /admin/products/reviewProduct — تأیید/رد آگهی در انتظار (منطق دامنه) */
  async reviewProduct(dto: ReviewAdminProductDto) {
    return this.products.reviewProduct({
      id: dto.id,
      approve: dto.approve,
      rejectionReasons: dto.rejectionReasons,
    });
  }

  /** POST /admin/products/setProductStatus — تغییر مستقیم وضعیت از هر حالتی.
   *  حذف → نرم (status=deleted) + پاک‌سازی فایل‌های گالری + خاموشی نردبان. */
  async setProductStatus(dto: SetProductStatusDto) {
    const p = await this.prisma.product.findUnique({ where: { id: dto.id } });
    if (!p) throw AppError.notFound('آگهی یافت نشد.');

    if (dto.status === 'rejected' && (!dto.rejectionReasons || dto.rejectionReasons.length === 0)) {
      throw AppError.badRequest('برای رد آگهی حداقل یک دلیل انتخاب کنید.', 'REASON_REQUIRED');
    }

    const toDeleted = dto.status === 'deleted' && p.status !== 'deleted';

    const updated = await this.prisma.product.update({
      where: { id: dto.id },
      data: {
        status: dto.status,
        ...(dto.status === 'rejected' ? { rejectionReasons: dto.rejectionReasons ?? [] } : {}),
        ...(dto.status !== 'rejected' ? { rejectionReasons: [] } : {}),
        ...(toDeleted ? { isLadder: false, ladderExpiresAt: null } : {}),
      },
    });

    // حذف فایل‌های گالری — سند File چندریختی + آبجکت‌های ذخیره‌سازی
    const filesRemoved = toDeleted
      ? await this.uploads.removeAllForModel('Product', String(dto.id))
      : 0;

    this.bustCaches(dto.id);
    return { id: updated.id, status: updated.status as string, files_removed: filesRemoved };
  }

  /** POST /admin/products/deleteProduct — حذف نرم + پاک‌سازی فایل‌های گالری (پیوند مستقیم چک‌لیست A4) */
  async deleteProduct(id: number) {
    return this.setProductStatus({ id, status: 'deleted' });
  }

  /** POST /admin/products/setLadder — روشن (هدیه ۳۰ روزه، LadderOrder با amount=0
   *  تا سابقه مالی سالم بماند) / خاموش (برچیدن نردبان جاری — مدیریتی). */
  async setLadder(dto: SetLadderDto) {
    const p = await this.prisma.product.findUnique({ where: { id: dto.id } });
    if (!p) throw AppError.notFound('آگهی یافت نشد.');

    if (dto.active) {
      if (p.status !== 'confirmed') {
        throw AppError.badRequest(
          'نردبان فقط روی آگهی تأییدشده فعال می‌شود؛ ابتدا آگهی را تأیید کنید.',
          'PRODUCT_NOT_CONFIRMED',
        );
      }
      // تمدید = امتداد از انقضای زنده، وگرنه از الان (عین منطق دامنه)
      const now = new Date();
      const currentExpiry =
        p.ladderExpiresAt && p.ladderExpiresAt > now ? p.ladderExpiresAt : null;
      const expiresAt = new Date((currentExpiry ?? now).getTime() + ADMIN_LADDER_MS);

      await this.prisma.$transaction([
        this.prisma.product.update({
          where: { id: dto.id },
          data: { isLadder: true, ladderExpiresAt: expiresAt },
        }),
        this.prisma.ladderOrder.create({
          data: {
            productId: dto.id,
            userId: p.userId,
            amount: 0, // هدیه ادمین — کاربر پولی پرداخت نکرده
            startsAt: now,
            expiresAt,
          },
        }),
      ]);

      this.bustCaches(dto.id);
      return { id: dto.id, is_ladder: true, ladder_expires_at: expiresAt, gift: true };
    }

    // خاموش — نردبان جاری برچیده می‌شود (سفارش‌های پرداخت‌شده در تاریخچه می‌مانند)
    const updated = await this.prisma.product.update({
      where: { id: dto.id },
      data: { isLadder: false, ladderExpiresAt: null },
    });
    this.bustCaches(dto.id);
    return { id: updated.id, is_ladder: false, ladder_expires_at: null };
  }

  // ─── داخلی ─────────────────────────────────────────────────────────────────

  /** where بدون فیلتر وضعیت — برای شمارنده‌های تب‌ها */
  private async statuslessWhere(dto: GetAdminProductListDto, s: string): Promise<Prisma.ProductWhereInput> {
    const base: Prisma.ProductWhereInput[] = [
      ...(dto.provinceId ? [{ provinceId: dto.provinceId }] : []),
      ...(dto.cityId ? [{ cityId: dto.cityId }] : []),
      ...(dto.ladder !== undefined ? [{ isLadder: dto.ladder }] : []),
      ...(dto.sellerId && OID_RE.test(dto.sellerId) ? [{ userId: dto.sellerId }] : []),
    ];
    if (dto.categoryId) {
      const ids = await this.categories.getSubtreeIds(dto.categoryId);
      if (ids.length > 0) {
        base.push({ OR: [{ subCategoryId: { in: ids } }, { categoryId: { in: ids } }] });
      }
    }
    if (s) {
      const catIds = await this.categories.searchCategoryIds(s);
      const or: Prisma.ProductWhereInput[] = [
        { productName: { contains: s } },
        { user: { OR: [{ phone: { contains: s } }, { userName: { contains: s } }] } },
      ];
      if (catIds.length > 0) {
        or.push({ subCategoryId: { in: catIds } }, { categoryId: { in: catIds } });
      }
      base.push({ OR: or });
    }
    return base.length > 0 ? { AND: base } : {};
  }

  private emptyList(page: number, perPage: number) {
    return {
      total: 0,
      page,
      perPage,
      pageCount: 1,
      counts: { pending: 0, confirmed: 0, rejected: 0, deleted: 0, all: 0 },
      items: [] as AdminProductRow[],
    };
  }

  /** join نام‌ها + گالری — گروهی، نه به‌ازای هر ردیف */
  private async toRows(rows: Array<{
    id: number; productName: string; status: string; categoryId: number; subCategoryId: number;
    provinceId: number; cityId: number; userId: string; stock: number; minSaleAmount: number;
    minSalePrice: number; unit: string; isLadder: boolean; ladderExpiresAt: Date | null;
    viewCount: number; rejectionReasons: unknown; createdAt: Date; updatedAt: Date;
  }>): Promise<AdminProductRow[]> {
    if (rows.length === 0) return [];

    const [gallery, userRows, catMap, locNames] = await Promise.all([
      this.uploads.galleryMap(rows.map((r) => r.id)),
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
        select: { id: true, userName: true, phone: true, isVerified: true, firstName: true, lastName: true },
      }),
      this.categories.getNameMap(),
      this.locations.getNames(
        [...new Set(rows.map((r) => r.provinceId))],
        [...new Set(rows.map((r) => r.cityId))],
      ),
    ]);

    const users = new Map(userRows.map((u) => [u.id, u]));
    const UNKNOWN = '—';

    return rows.map((p) => {
      const seller = users.get(p.userId);
      const photo = gallery.get(p.id)?.[0];
      return {
        id: p.id,
        product_name: p.productName,
        status: p.status as ProductStatusKey,
        category_name: catMap.get(p.categoryId)?.category_name ?? UNKNOWN,
        sub_category_name: catMap.get(p.subCategoryId)?.category_name ?? UNKNOWN,
        province_name: locNames.provinces.get(p.provinceId) ?? UNKNOWN,
        city_name: locNames.cities.get(p.cityId) ?? UNKNOWN,
        seller: {
          id: p.userId,
          user_name: seller?.userName ?? UNKNOWN,
          // نام کامل برای نمایش (خواسته مالک) — فالبک نام کاربری/موبایل
          full_name: [seller?.firstName, seller?.lastName].filter(Boolean).join(' ').trim() || seller?.userName || '',
          phone: seller?.phone ?? '',
          is_verified: seller?.isVerified ?? false,
        },
        stock: p.stock,
        min_sale_amount: p.minSaleAmount,
        min_sale_price: p.minSalePrice,
        unit: p.unit,
        is_ladder: p.isLadder,
        ladder_expires_at: p.ladderExpiresAt,
        view_count: p.viewCount,
        photo: photo?.thumbUrl ?? photo?.url ?? null,
        rejection_reasons: Array.isArray(p.rejectionReasons) ? (p.rejectionReasons as string[]) : [],
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      };
    });
  }

  /** گالری کامل یک آگهی (برای جزئیات) */
  private async galleryUrls(productId: number): Promise<string[]> {
    const files = (await this.uploads.galleryMap([productId])).get(productId) ?? [];
    return files.map((f) => f.url);
  }

  /** ابطال کش لیست عمومی + جزئیات همان آگهی */
  private bustCaches(id: number): void {
    this.cache.invalidateTag('products');
    this.cache.invalidateTag(`product:${id}`);
  }
}
