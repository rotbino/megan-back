import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.module';
import { CacheService } from '../../common/cache/cache.module';
import { AppError } from '../../common/errors/app-error';
import { WalletService } from '../../wallet/wallet.service';
import { VerificationService } from '../../verification/verification.service';
import type {
  CreditWalletDto,
  GetUserListDto,
  GetVerificationOrdersAdminDto,
  ReviewVerificationAdminDto,
  SetUserActiveDto,
  SetUserRolesDto,
} from './dto';

const OID_RE = /^[0-9a-fA-F]{24}$/;

/** ردیف جدول مدیریت کاربران — فقط شناسه‌ها از DB؛ نام‌ها همان‌جا هستند */
export interface AdminUserRow {
  id: string;
  phone: string;
  user_name: string;
  first_name: string;
  last_name: string;
  sex: string | null;
  role: string;
  is_verified: boolean;
  is_buyer: boolean;
  is_seller: boolean;
  is_active: boolean;
  has_password: boolean;
  wallet_balance: number;
  province_id: number | null;
  city_id: number | null;
  product_count: number;
  request_count: number;
  /** pending | verified | none — برای چیپ وضعیت احراز */
  verification: 'pending' | 'verified' | 'none';
  last_login_at: Date | null;
  created_at: Date;
}

/**
 * فاز A3 — مدیریت کاربران پنل ادمین.
 *
 * مرزها (docs/ADMIN-IMPLEMENTATION.md §۱):
 *  • منطق کیف پول و احراز اسناد از سرویس‌های دامنه (WalletService /
 *    VerificationService) با export مصرف می‌شود — کپی نمی‌شود.
 *  • غیرفعال‌سازی = حذف نرم: ورود مسدود + نشست‌ها باطل + محتوا از
 *    لیست‌های عمومی پنهان؛ داده‌های کاربر هرگز حذف نمی‌شوند.
 *  • پس از هر نوشتن، کش‌های تگ‌دار لیست‌های عمومی (نام‌ها join می‌شوند)
 *    ابطال می‌شوند تا تغییر بلافاصله دیده شود.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly wallet: WalletService,
    private readonly verification: VerificationService,
  ) {}

  // ─── لیست + جستجو + فیلتر ──────────────────────────────────────────────────

  /** POST /admin/users/getUserList — جستجو/فیلتر/صفحه‌بندی + شمارنده‌های ردیف */
  async getUserList(dto: GetUserListDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));
    const s = dto.search?.trim();

    const where: Prisma.UserWhereInput = {
      ...(dto.role ? { role: dto.role } : {}),
      ...(dto.active !== undefined ? { isActive: dto.active } : {}),
      ...(dto.verified !== undefined ? { isVerified: dto.verified } : {}),
      ...(dto.seller !== undefined ? { isSeller: dto.seller } : {}),
      ...(s
        ? {
            OR: [
              { phone: { contains: s } },
              { userName: { contains: s } },
              { firstName: { contains: s } },
              { lastName: { contains: s } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    // شمارنده‌های هر ردیف — گروهی (نه به‌ازای هر ردیف)
    const ids = rows.map((r) => r.id);
    const [productCounts, requestCounts, pendingVerifications] = ids.length
      ? await Promise.all([
          this.prisma.product.groupBy({ by: ['userId'], _count: { _all: true }, where: { userId: { in: ids } } }),
          this.prisma.buyRequest.groupBy({ by: ['userId'], _count: { _all: true }, where: { userId: { in: ids } } }),
          this.prisma.verificationOrder.findMany({
            where: { userId: { in: ids }, status: 'pending' },
            select: { userId: true },
          }),
        ])
      : [[], [], []];

    const productMap = new Map(productCounts.map((p) => [p.userId, p._count._all]));
    const requestMap = new Map(requestCounts.map((r) => [r.userId, r._count._all]));
    const pendingSet = new Set(pendingVerifications.map((v) => v.userId));

    return {
      total,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      items: rows.map<AdminUserRow>((u) => ({
        id: u.id,
        phone: u.phone,
        user_name: u.userName,
        first_name: u.firstName,
        last_name: u.lastName,
        sex: u.sex,
        role: u.role,
        is_verified: u.isVerified,
        is_buyer: u.isBuyer,
        is_seller: u.isSeller,
        is_active: u.isActive,
        has_password: Boolean(u.passwordHash),
        wallet_balance: u.walletBalance,
        province_id: u.provinceId,
        city_id: u.cityId,
        product_count: productMap.get(u.id) ?? 0,
        request_count: requestMap.get(u.id) ?? 0,
        verification: u.isVerified ? 'verified' : pendingSet.has(u.id) ? 'pending' : 'none',
        last_login_at: u.lastLoginAt,
        created_at: u.createdAt,
      })),
    };
  }

  // ─── جزئیات کامل ───────────────────────────────────────────────────────────

  /** POST /admin/users/getUserDetail — پروفایل + آمار + آگهی‌ها + کیف پول + احراز */
  async getUserDetail(id: string) {
    if (!OID_RE.test(id)) throw AppError.notFound('کاربر یافت نشد.');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw AppError.notFound('کاربر یافت نشد.');

    const [province, city, productsByStatus, recentProducts, chargeStats, ladderCount, transactions, verification] =
      await Promise.all([
        user.provinceId == null
          ? null
          : this.prisma.location.findUnique({ where: { id: `province:${user.provinceId}` } }),
        user.cityId == null
          ? null
          : this.prisma.location.findUnique({ where: { id: `city:${user.cityId}` } }),
        this.prisma.product.groupBy({ by: ['status'], _count: { _all: true }, where: { userId: id } }),
        this.prisma.product.findMany({
          where: { userId: id },
          orderBy: { updatedAt: 'desc' },
          take: 10,
          select: {
            id: true, productName: true, status: true, stock: true, minSaleAmount: true,
            minSalePrice: true, unit: true, viewCount: true, isLadder: true, updatedAt: true,
          },
        }),
        this.prisma.chargeOrder.groupBy({ by: ['status'], _count: { _all: true }, where: { userId: id } }),
        this.prisma.ladderOrder.count({ where: { userId: id } }),
        this.wallet.getWalletTransactions(id),
        this.verification.getMy(id),
      ]);

    const statusCount = (status: string): number =>
      productsByStatus.find((p) => p.status === status)?._count._all ?? 0;

    return {
      user: {
        id: user.id,
        phone: user.phone,
        user_name: user.userName,
        first_name: user.firstName,
        last_name: user.lastName,
        sex: user.sex,
        role: user.role,
        is_verified: user.isVerified,
        is_buyer: user.isBuyer,
        is_seller: user.isSeller,
        is_active: user.isActive,
        has_password: Boolean(user.passwordHash),
        wallet_balance: user.walletBalance,
        avatar_url: user.avatarUrl,
        business_desc: user.businessDesc,
        province_id: user.provinceId,
        city_id: user.cityId,
        province: province?.name ?? null,
        city: city?.name ?? null,
        profile: user.profile ?? {},
        last_login_at: user.lastLoginAt,
        created_at: user.createdAt,
      },
      stats: {
        products: {
          confirmed: statusCount('confirmed'),
          pending: statusCount('pending'),
          rejected: statusCount('rejected'),
          deleted: statusCount('deleted'),
        },
        buy_requests: await this.prisma.buyRequest.count({ where: { userId: id } }),
        charges: {
          pending: chargeStats.find((c) => c.status === 'pending')?._count._all ?? 0,
          approved: chargeStats.find((c) => c.status === 'approved')?._count._all ?? 0,
          rejected: chargeStats.find((c) => c.status === 'rejected')?._count._all ?? 0,
        },
        ladder_orders: ladderCount,
      },
      products: recentProducts,
      transactions: transactions.items.slice(0, 15),
      verification,
    };
  }

  // ─── عملیات ────────────────────────────────────────────────────────────────

  /** POST /admin/users/setUserActive — فعال/غیرفعال (حذف نرم).
   *  غیرفعال: ورود مسدود + همه نشست‌ها باطل + محتوا از لیست‌های عمومی پنهان. */
  async setUserActive(adminId: string, dto: SetUserActiveDto) {
    if (!OID_RE.test(dto.id)) throw AppError.notFound('کاربر یافت نشد.');
    const user = await this.prisma.user.findUnique({ where: { id: dto.id } });
    if (!user) throw AppError.notFound('کاربر یافت نشد.');

    const updated = await this.prisma.user.update({
      where: { id: dto.id },
      data: { isActive: dto.active },
    });

    if (!dto.active) {
      // نشست‌های باز فوراً باطل شوند (refresh chain می‌میرد)
      await this.prisma.refreshToken.updateMany({
        where: { userId: dto.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    // لیست‌های عمومی نام/محقِ کاربر را join می‌کنند — بیات کردن
    this.invalidatePublicCaches();

    return {
      id: updated.id,
      is_active: updated.isActive,
      revoked_sessions: dto.active ? 0 : undefined,
      by_admin: adminId,
    };
  }

  /** POST /admin/users/setUserRoles — خریدار/فروشنده/نقش سیستم */
  async setUserRoles(dto: SetUserRolesDto) {
    if (!OID_RE.test(dto.id)) throw AppError.notFound('کاربر یافت نشد.');
    const user = await this.prisma.user.findUnique({ where: { id: dto.id } });
    if (!user) throw AppError.notFound('کاربر یافت نشد.');

    if (dto.role === 'ADMIN' && user.role !== 'ADMIN') {
      // ارتقا به ADMIN روی توکن کاربر — عمل حساس؛ فعلاً فقط SUPER_ADMIN پنل
      // (A5) اجازه‌اش را خواهد داد. اینجا عمداً رد می‌شود تا مسیر قدیمی بسته بماند.
      throw AppError.forbidden('ارتقای نقش به ADMIN فقط از طریق مدیر ارشد (فاز A5) ممکن است.');
    }
    if (dto.role === 'USER' && user.role === 'ADMIN') {
      throw AppError.forbidden('تنزل نقش ADMIN فقط از طریق مدیر ارشد (فاز A5) ممکن است.');
    }

    const updated = await this.prisma.user.update({
      where: { id: dto.id },
      data: {
        ...(dto.isBuyer !== undefined ? { isBuyer: dto.isBuyer } : {}),
        ...(dto.isSeller !== undefined ? { isSeller: dto.isSeller } : {}),
      },
    });

    this.invalidatePublicCaches();

    return {
      id: updated.id,
      is_buyer: updated.isBuyer,
      is_seller: updated.isSeller,
      role: updated.role,
    };
  }

  /** POST /admin/users/creditWallet — شارژ/کسر دستی با دلیل (WalletAdjustment) */
  async creditWallet(adminId: string, dto: CreditWalletDto) {
    if (!OID_RE.test(dto.id)) throw AppError.notFound('کاربر یافت نشد.');
    const user = await this.prisma.user.findUnique({
      where: { id: dto.id },
      select: { id: true },
    });
    if (!user) throw AppError.notFound('کاربر یافت نشد.');

    const result = await this.wallet.adjustWallet(adminId, dto.id, dto.amount, dto.reason.trim());
    return { id: dto.id, ...result };
  }

  /** POST /admin/users/getVerificationOrders — صف احراز هویت (سرویس دامنه B6) */
  async getVerificationOrders(dto: GetVerificationOrdersAdminDto) {
    return this.verification.listOrders({
      status: dto.status,
      page: dto.page,
      perPage: dto.perPage,
    });
  }

  /** POST /admin/users/reviewVerification — تأیید/رد مدارک (سرویس دامنه B6) */
  async reviewVerification(adminId: string, adminUsername: string, dto: ReviewVerificationAdminDto) {
    // منطق از VerificationService — ادمین فقط با AdminUser احراز شده می‌رسد
    return this.verification.review({ id: adminId, phone: adminUsername, role: 'ADMIN' }, {
      orderId: dto.orderId,
      approve: dto.approve,
      rejectionReason: dto.rejectionReason,
    });
  }

  // ─── داخلی ─────────────────────────────────────────────────────────────────

  /** ابطال کش‌های لیست‌های عمومی — نام/محق کاربر join می‌شود */
  private invalidatePublicCaches(): void {
    this.cache.invalidateTag('products');
    this.cache.invalidateTag('buy-requests');
  }
}
