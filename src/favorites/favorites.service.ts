import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import { ProductsService } from '../products/products.service';
import { LocationsService } from '../locations/locations.service';
import type { AuthUser } from '../common/guards';

/** سقف علاقه‌مندی‌ها — مثل ظرفیت لیست‌های CRM باسکول */
const FAVORITES_LIMIT = 200;

export interface FavoriteSellerDto {
  userName: string;
  firstName: string;
  lastName: string;
  isVerified: boolean;
  /** نشان فروشنده ویژه (اشتراک فعال) */
  isPremium: boolean;
  avatarUrl: string | null;
  productCount: number;
  provinceName: string | null;
  cityName: string | null;
  savedAt: Date;
}

/**
 * ─── علاقه‌مندی‌ها (خواسته مالک ۳۰-۱۰) ──────────────────────────────────────
 * دو موجودیت مستقل:
 *  • FavoriteProduct — «نشان کردن» آگهی (دکمه ذخیره صفحه آگهی)
 *  • FavoriteSeller  — ذخیره صفحه اختصاصی فروشنده (دکمه ذخیره پروفایل)
 * آمار «چه کسانی آگهی را ذخیره کردند» در products.getMyProductStats از همین
 * جدول FavoriteProduct خوانده می‌شود.
 */
@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly locations: LocationsService,
  ) {}

  /** POST /favorites/toggleProduct — نشان/حذف نشان آگهی */
  async toggleProduct(user: AuthUser, productId: number) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true, userId: true },
    });
    if (!product || product.status === 'deleted') {
      throw AppError.notFound('آگهی مورد نظر پیدا نشد.');
    }

    const existing = await this.prisma.favoriteProduct.findUnique({
      where: { userId_productId: { userId: user.id, productId } },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.favoriteProduct.delete({ where: { id: existing.id } });
      return { saved: false as const };
    }

    await this.assertCapacity(user.id, 'product');
    await this.prisma.favoriteProduct.create({ data: { userId: user.id, productId } });
    return { saved: true as const };
  }

  /** POST /favorites/toggleSeller — ذخیره/حذف صفحه اختصاصی فروشنده */
  async toggleSeller(user: AuthUser, userName: string) {
    const seller = await this.prisma.user.findUnique({
      where: { userName: userName.trim() },
      select: { id: true, isActive: true },
    });
    if (!seller || !seller.isActive) throw AppError.notFound('فروشنده مورد نظر پیدا نشد.');
    if (seller.id === user.id) {
      throw AppError.badRequest('صفحه خودتان قابل ذخیره نیست.', 'SELF_FAVORITE');
    }

    const existing = await this.prisma.favoriteSeller.findUnique({
      where: { userId_sellerId: { userId: user.id, sellerId: seller.id } },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.favoriteSeller.delete({ where: { id: existing.id } });
      return { saved: false as const };
    }

    await this.assertCapacity(user.id, 'seller');
    await this.prisma.favoriteSeller.create({ data: { userId: user.id, sellerId: seller.id } });
    return { saved: true as const };
  }

  /** POST /favorites/getMyProductFavoriteIds — شناسه آگهی‌های نشان‌شده من */
  async getMyProductFavoriteIds(userId: string): Promise<number[]> {
    const rows = await this.prisma.favoriteProduct.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { productId: true },
      take: FAVORITES_LIMIT,
    });
    return rows.map((r) => r.productId);
  }

  /** POST /favorites/isSellerSaved — وضعیت ذخیره یک فروشنده (دکمه پروفایل) */
  async isSellerSaved(userId: string, userName: string): Promise<boolean> {
    const seller = await this.prisma.user.findUnique({
      where: { userName: userName.trim() },
      select: { id: true },
    });
    if (!seller) return false;
    const row = await this.prisma.favoriteSeller.findUnique({
      where: { userId_sellerId: { userId, sellerId: seller.id } },
      select: { id: true },
    });
    return row != null;
  }

  /** POST /favorites/getMyFavorites — آگهی‌ها + فروشندگان ذخیره‌شده من */
  async getMyFavorites(userId: string) {
    const [productRows, sellerRows] = await Promise.all([
      this.prisma.favoriteProduct.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: FAVORITES_LIMIT,
      }),
      this.prisma.favoriteSeller.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: FAVORITES_LIMIT,
      }),
    ]);

    // آگهی‌ها — hydrate کامل با سرویس محصولات (ترتیب = تازه‌ترین نشان اول)
    const products = await this.products.getProductsByIds(productRows.map((r) => r.productId));

    // فروشندگان — کارت سبک: مشخصات + شمار آگهی + مکان + آواتار
    const sellerIds = sellerRows.map((r) => r.sellerId);
    const [sellers, counts, avatars] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: sellerIds }, isActive: true },
        select: {
          id: true,
          userName: true,
          firstName: true,
          lastName: true,
          isVerified: true,
          activePakageType: true,
          packageExpiresAt: true,
          provinceId: true,
          cityId: true,
        },
      }),
      this.prisma.product.groupBy({
        by: ['userId'],
        where: { userId: { in: sellerIds }, status: 'confirmed' },
        _count: { _all: true },
      }),
      this.prisma.file.findMany({
        where: { relatedModel: 'User', relatedId: { in: sellerIds }, fieldKey: 'avatar' },
        orderBy: { createdAt: 'desc' },
        select: { relatedId: true, url: true, thumbUrl: true },
      }),
    ]);
    const sellerMap = new Map(sellers.map((s) => [s.id, s]));
    const countMap = new Map(counts.map((c) => [c.userId, c._count._all]));
    const avatarMap = new Map<string, string>(); // اولین (تازه‌ترین) آواتار هر کاربر
    for (const a of avatars) {
      if (!avatarMap.has(a.relatedId ?? '')) avatarMap.set(a.relatedId ?? '', a.thumbUrl ?? a.url);
    }

    const sellerDtos: FavoriteSellerDto[] = [];
    for (const row of sellerRows) {
      const s = sellerMap.get(row.sellerId);
      if (!s) continue; // فروشنده غیرفعال/حذف‌شده — رد می‌شود
      const now = Date.now();
      const isPremium =
        s.activePakageType > 0 &&
        s.packageExpiresAt != null &&
        s.packageExpiresAt.getTime() > now;
      sellerDtos.push({
        userName: s.userName,
        firstName: s.firstName,
        lastName: s.lastName,
        isVerified: s.isVerified,
        isPremium,
        avatarUrl: avatarMap.get(s.id) ?? null,
        productCount: countMap.get(s.id) ?? 0,
        provinceName: null, // پایین‌تر پر می‌شود
        cityName: null,
        savedAt: row.createdAt,
      });
    }

    // نام مکان فروشندگان — join دستی (ارائه سبک، بدون کش آگهی)
    const provinceIds = [...new Set(sellers.map((s) => s.provinceId).filter((p): p is number => p != null))];
    const cityIds = [...new Set(sellers.map((s) => s.cityId).filter((c): c is number => c != null))];
    const names = await this.locations.getNames(provinceIds, cityIds);
    const sellerById = new Map(sellers.map((s) => [s.id, s]));
    for (const dto of sellerDtos) {
      const s = [...sellerById.values()].find((x) => x.userName === dto.userName);
      if (!s) continue;
      dto.provinceName = s.provinceId != null ? (names.provinces.get(s.provinceId) ?? null) : null;
      dto.cityName = s.cityId != null ? (names.cities.get(s.cityId) ?? null) : null;
    }

    return { products, sellers: sellerDtos };
  }

  /** سقف ظرفیت — جلوگیری از انباشت بی‌سقف */
  private async assertCapacity(userId: string, kind: 'product' | 'seller') {
    const count =
      kind === 'product'
        ? await this.prisma.favoriteProduct.count({ where: { userId } })
        : await this.prisma.favoriteSeller.count({ where: { userId } });
    if (count >= FAVORITES_LIMIT) {
      throw AppError.badRequest(
        `حداکثر ${FAVORITES_LIMIT} مورد قابل ذخیره است — ابتدا برخی را حذف کنید.`,
        'FAVORITES_FULL',
      );
    }
  }
}
