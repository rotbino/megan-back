import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';
import { UploadsService } from '../uploads/uploads.service';
import { wallet as walletEnv } from '../common/config/env';
import type { AuthUser } from '../common/guards';
import { GetChargeOrdersDto, LadderProductDto, ReviewChargeOrderDto } from './dto';

/** پکیج‌های شارژ کارت‌به‌کارت — عین UI باسکول (۳ پکیج؛ ۲۰۰ و ۴۰۰ با شارژ اضافه) */
export const CHARGE_PACKAGES = [
  { key: 'p100', amount: 100_000, bonusPercent: 0, charge: 100_000 },
  { key: 'p200', amount: 200_000, bonusPercent: 10, charge: 220_000 },
  { key: 'p400', amount: 400_000, bonusPercent: 20, charge: 480_000 },
] as const;

/** نردبان هر محصول برای یک ماه — از کیف پول کسر می‌شود (تنها قابلیت تبلیغاتی) */
export const LADDER_MONTHLY_PRICE = 100_000;

/** مدت نردبان: ۳۰ روز */
const LADDER_DURATION_MS = 30 * 86_400_000;

/** حداکثر تراکنش‌های برگشتی در تاریخچه */
const TRANSACTIONS_LIMIT = 100;

const OID_RE = /^[0-9a-fA-F]{24}$/;

export interface WalletTransactionDto {
  id: string;
  title: string;
  amount: number;
  incoming: boolean;
  /** شارژ کارت‌به‌کارت تا تأیید ادمین «در انتظار تایید» است */
  pendingAdmin: boolean;
  at: Date;
}

/**
 * ─── کیف پول و نردبان (B9) ───────────────────────────────────────────────────
 *
 * کیف پول (عین پنل باسکول):
 *  • شارژ کارت‌به‌کارت — جایگزین درگاه پرداخت: کاربر یکی از ۳ پکیج را به کارت
 *    ایمچ واریز می‌کند + تصویر فیش را می‌فرستد (ChargeOrder + فیش در جدول File
 *    با دکترین ضد-فایل-سرگردان) → ادمین تأیید/رد می‌کند → شارژ (با احتساب
 *    درصد اضافه) به موجودی اضافه می‌شود.
 *  • تاریخچه تراکنش‌ها — شارژها + کسر نردبان‌ها، یکجا به‌صورت مرتب.
 *
 * نردبان (تنها قابلیت تبلیغاتی مگان — ۱۰۰هزار/ماه):
 *  • هزینه لحظه خرید به‌صورت اتمیک از کیف پول کسر می‌شود (گارد شرطی داخل
 *    تراکنش → امکان خرج موازی وجود ندارد)؛ is_ladder + ladder_expires_at روی
 *    خود آگهی denorm می‌شوند و سورت «مرتبط‌ترین» نردبان زنده را صدر می‌گذارد.
 *  • تمدید = امتداد از انقضای فعلی. انقضای گذشته با فیلتر زنده لیست + reaper
 *    دوره‌ای همین ماژول غیرفعال می‌شود (TTL ایندکس در Prisma نیست).
 */
@Injectable()
export class WalletService implements OnModuleInit, OnModuleDestroy {
  private reaperTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly uploads: UploadsService,
  ) {}

  /** پاک‌سازی نردبان‌های منقضی — یک‌بار دیرهنگام بعد از بوت، بعد هر ساعت */
  onModuleInit(): void {
    const boot = setTimeout(() => void this.reapExpiredLadders(), 60_000);
    boot.unref?.();
    this.reaperTimer = setInterval(() => void this.reapExpiredLadders(), 60 * 60 * 1000);
    this.reaperTimer.unref?.();
  }
  onModuleDestroy(): void {
    if (this.reaperTimer) clearInterval(this.reaperTimer);
  }

  private async reapExpiredLadders(): Promise<void> {
    try {
      const res = await this.prisma.product.updateMany({
        where: { isLadder: true, ladderExpiresAt: { lt: new Date() } },
        data: { isLadder: false },
      });
      if (res.count > 0) this.cache.invalidateTag('products');
    } catch {
      /* reaper هرگز نباید کاربر را بیدار کند */
    }
  }

  // ─── کیف پول ────────────────────────────────────────────────────────────────

  /** POST /wallet/getWallet — موجودی + کارت واریز + پکیج‌ها + قیمت نردبان */
  async getWallet(userId: string) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { walletBalance: true },
    });
    if (!me) throw AppError.notFound('حساب کاربری یافت نشد.');

    return {
      balance: me.walletBalance,
      /** حداقل شارژ — برابر هزینه نردبان یک‌ماهه (عین باسکول) */
      minCharge: LADDER_MONTHLY_PRICE,
      ladderMonthlyPrice: LADDER_MONTHLY_PRICE,
      cardNumber: walletEnv.CARD_NUMBER,
      cardOwner: walletEnv.CARD_OWNER,
      packages: CHARGE_PACKAGES,
    };
  }

  /** POST /wallet/getWalletTransactions — شارژها + نردبان‌ها + اصلاح‌های ادمین، یکجا و مرتب */
  async getWalletTransactions(userId: string): Promise<{ items: WalletTransactionDto[] }> {
    const [charges, ladders, adjustments] = await Promise.all([
      this.prisma.chargeOrder.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: TRANSACTIONS_LIMIT,
      }),
      this.prisma.ladderOrder.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: TRANSACTIONS_LIMIT,
        select: { id: true, productId: true, amount: true, createdAt: true },
      }),
      this.prisma.walletAdjustment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: TRANSACTIONS_LIMIT,
      }),
    ]);

    // نام آگهی برای عنوان نردبان — گروهی
    const productIds = [...new Set(ladders.map((l) => l.productId))];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, productName: true },
        })
      : [];
    const productName = new Map(products.map((p) => [p.id, p.productName]));

    const items: WalletTransactionDto[] = [
      ...charges.map((c) => ({
        id: `charge:${c.id}`,
        title:
          c.status === 'rejected'
            ? 'شارژ کیف پول — کارت به کارت (رد شد)'
            : 'شارژ کیف پول — کارت به کارت',
        amount: c.status === 'rejected' ? c.amount : c.charge,
        incoming: c.status !== 'rejected',
        pendingAdmin: c.status === 'pending',
        at: c.createdAt,
      })),
      ...ladders.map((l) => ({
        id: `ladder:${l.id}`,
        title: `نردبان «${productName.get(l.productId) ?? 'آگهی'}» — یک‌ماهه`,
        amount: l.amount,
        incoming: false,
        pendingAdmin: false,
        at: l.createdAt,
      })),
      ...adjustments.map((a) => ({
        id: `adjust:${a.id}`,
        title: `اصلاح کیف پول — ${a.reason}`,
        amount: Math.abs(a.amount),
        incoming: a.amount > 0,
        pendingAdmin: false,
        at: a.createdAt,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    return { items };
  }

  /** POST /wallet/createChargeOrder (multipart: packageKey + receipt) — فیش واریزی */
  async createChargeOrder(user: AuthUser, req: FastifyRequest) {
    // ۱) پکیج + فیش — فقط این دو فیلد پذیرفته می‌شوند
    const { fields, files } = await this.uploads.readMultipartMulti(req, ['receipt']);
    const packageKey = (fields.packageKey || '').trim();
    const pkg = CHARGE_PACKAGES.find((p) => p.key === packageKey);
    if (!pkg) {
      throw AppError.badRequest('پکیج شارژ نامعتبر است.', 'PACKAGE_INVALID');
    }
    const receipt = files.get('receipt');
    if (!receipt) {
      throw AppError.badRequest('تصویر فیش واریزی الزامی است.', 'RECEIPT_MISSING');
    }

    // ۲) سفارش (ردیف مرجع) → ۳) چسباندن فیش با اعتبارسنجی کامل uploads
    //    (عین B6: اسلات تک‌فایلی receipt با replace + جبران کامل در خطا)
    const order = await this.prisma.chargeOrder.create({
      data: {
        userId: user.id,
        packageKey: pkg.key,
        amount: pkg.amount,
        bonusPercent: pkg.bonusPercent,
        charge: pkg.charge,
      },
    });
    try {
      await this.uploads.upload(
        user,
        { model: 'ChargeOrder', modelId: order.id, fieldKey: 'receipt', replace: true },
        receipt,
      );
    } catch (err) {
      await this.uploads.removeAllForModel('ChargeOrder', order.id).catch(() => undefined);
      await this.prisma.chargeOrder.delete({ where: { id: order.id } }).catch(() => undefined);
      throw err;
    }

    return {
      orderId: order.id,
      packageKey: pkg.key,
      amount: pkg.amount,
      charge: pkg.charge,
      status: 'pending' as const,
    };
  }

  // ─── نردبان ─────────────────────────────────────────────────────────────────

  /** POST /wallet/ladderProduct — نردبان یک‌ماهه از کیف پول (اتمیک) */
  async ladderProduct(user: AuthUser, dto: LadderProductDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, userId: true, status: true, productName: true, isLadder: true, ladderExpiresAt: true },
    });
    if (!product || product.status === 'deleted') {
      throw AppError.notFound('محصول یافت نشد.');
    }
    if (product.userId !== user.id) {
      throw AppError.forbidden('فقط آگهی خودتان را می‌توانید نردبان کنید.');
    }
    if (product.status !== 'confirmed') {
      throw AppError.badRequest(
        'نردبان فقط برای آگهی‌های تأییدشده فعال می‌شود؛ آگهی شما هنوز در انتظار تأیید است.',
        'PRODUCT_NOT_CONFIRMED',
      );
    }

    // موجودی — پیام دوستانه قبل از تراکنش؛ گارد اتمیک خودش داخل تراکنش است
    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { walletBalance: true },
    });
    if (!me || me.walletBalance < LADDER_MONTHLY_PRICE) {
      throw AppError.badRequest(
        'موجودی کیف پول برای نردبان کافی نیست — ابتدا کیف پول خود را شارژ کنید.',
        'WALLET_INSUFFICIENT',
      );
    }

    // تمدید = امتداد از انقضای فعلی (اگر هنوز زنده است)، وگرنه از الان
    const now = new Date();
    const currentExpiry = product.ladderExpiresAt && product.ladderExpiresAt > now ? product.ladderExpiresAt : null;
    const expiresAt = new Date((currentExpiry ?? now).getTime() + LADDER_DURATION_MS);

    try {
      await this.prisma.$transaction([
        // گارد شرطی اتمیک: فقط اگر موجودی هنوز کافی باشد کم می‌شود (P2025 → کافی نیست)
        this.prisma.user.update({
          where: { id: user.id, walletBalance: { gte: LADDER_MONTHLY_PRICE } },
          data: { walletBalance: { decrement: LADDER_MONTHLY_PRICE } },
        }),
        this.prisma.product.update({
          where: { id: product.id },
          data: { isLadder: true, ladderExpiresAt: expiresAt },
        }),
        this.prisma.ladderOrder.create({
          data: {
            productId: product.id,
            userId: user.id,
            amount: LADDER_MONTHLY_PRICE,
            startsAt: now,
            expiresAt,
          },
        }),
      ]);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw AppError.badRequest(
          'موجودی کیف پول برای نردبان کافی نیست — ابتدا کیف پول خود را شارژ کنید.',
          'WALLET_INSUFFICIENT',
        );
      }
      throw err;
    }

    // آگهی کش‌شده فوراً تازه شود (سورت «مرتبط‌ترین» نردبان را صدر می‌گذارد)
    this.cache.invalidateTag('products');
    this.cache.invalidateTag(`product:${product.id}`);

    const after = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { walletBalance: true },
    });

    return {
      productId: product.id,
      productName: product.productName,
      isLadder: true,
      ladderExpiresAt: expiresAt,
      balance: after?.walletBalance ?? me.walletBalance - LADDER_MONTHLY_PRICE,
    };
  }

  // ─── ادمین: شارژ/کسر دستی (A3) ─────────────────────────────────────────

  /**
   * اصلاح دستی کیف پول توسط ادمین — شارژ (مثبت) یا کسر (منفی) با دلیل.
   * گارد شرطی اتمیک برای کسر (موجودی منفی نمی‌شود) + رکورد WalletAdjustment
   * با موجودیت نهایی برای مرور حساب؛ در تاریخچه کاربر با عنوان «اصلاح کیف پول» دیده می‌شود.
   */
  async adjustWallet(
    adminId: string,
    userId: string,
    amount: number,
    reason: string,
  ): Promise<{ balance: number; adjustment: { id: string; amount: number; reason: string } }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, walletBalance: true },
    });
    if (!user) throw AppError.notFound('کاربر یافت نشد.');

    if (amount < 0 && user.walletBalance + amount < 0) {
      throw AppError.badRequest(
        `موجودی کاربر برای این کسر کافی نیست (موجودی فعلی: ${user.walletBalance.toLocaleString('fa-IR')} تومان).`,
        'WALLET_INSUFFICIENT',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // کسر با گارد اتمیک (P2025 → همزمانی)؛ شارژ بی‌قید
      const updated = await tx.user.update({
        where:
          amount < 0
            ? { id: userId, walletBalance: { gte: -amount } }
            : { id: userId },
        data: { walletBalance: { increment: amount } },
      });
      const adjustment = await tx.walletAdjustment.create({
        data: { userId, amount, reason, adminId, balanceAfter: updated.walletBalance },
      });
      return { balance: updated.walletBalance, adjustment };
    });

    return {
      balance: result.balance,
      adjustment: {
        id: result.adjustment.id,
        amount: result.adjustment.amount,
        reason: result.adjustment.reason,
      },
    };
  }

  // ─── ادمین: صف شارژها ──────────────────────────────────────────────────────

  /** POST /wallet/getChargeOrders (ادمین) — صف بررسی فیش‌ها */
  async getChargeOrders(dto: GetChargeOrdersDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));
    const where = { ...(dto.status ? { status: dto.status } : {}) };

    const [total, rows] = await Promise.all([
      this.prisma.chargeOrder.count({ where }),
      this.prisma.chargeOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    // کاربران + فیش‌ها — گروهی، نه به‌ازای هر ردیف
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, phone: true, userName: true, firstName: true, lastName: true, walletBalance: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const orderIds = rows.map((r) => r.id);
    const files = orderIds.length
      ? await this.prisma.file.findMany({
          where: { relatedModel: 'ChargeOrder', relatedId: { in: orderIds }, fieldKey: 'receipt' },
          select: { id: true, relatedId: true, url: true, thumbUrl: true, createdAt: true },
        })
      : [];
    const fileMap = new Map(files.map((f) => [f.relatedId!, f]));

    return {
      total,
      page,
      perPage,
      items: rows.map((r) => {
        const u = userMap.get(r.userId);
        const receipt = fileMap.get(r.id);
        return {
          id: r.id,
          status: r.status,
          packageKey: r.packageKey,
          amount: r.amount,
          bonusPercent: r.bonusPercent,
          charge: r.charge,
          rejectionReason: r.rejectionReason,
          reviewedAt: r.reviewedAt,
          createdAt: r.createdAt,
          user: {
            id: r.userId,
            phone: u?.phone ?? '',
            user_name: u?.userName ?? '',
            first_name: u?.firstName ?? '',
            last_name: u?.lastName ?? '',
            wallet_balance: u?.walletBalance ?? 0,
          },
          receipt: receipt ?? null,
        };
      }),
    };
  }

  /** POST /wallet/reviewChargeOrder (ادمین) — تأیید → شارژ کیف پول؛ رد → دلیل */
  async reviewChargeOrder(admin: AuthUser, dto: ReviewChargeOrderDto) {
    if (!OID_RE.test(dto.orderId)) {
      throw AppError.notFound('سفارش شارژ یافت نشد.');
    }
    const order = await this.prisma.chargeOrder.findUnique({ where: { id: dto.orderId } });
    if (!order) throw AppError.notFound('سفارش شارژ یافت نشد.');
    if (order.status !== 'pending') {
      throw AppError.conflict('این سفارش قبلاً بررسی شده است.', 'ALREADY_REVIEWED');
    }

    const reason = dto.rejectionReason?.trim();
    if (!dto.approve && !reason) {
      throw AppError.badRequest('دلیل رد شدن را وارد کنید.', 'REASON_REQUIRED');
    }

    if (dto.approve) {
      // تأیید → شارژ (با احتساب درصد اضافه) اتمیک به کیف پول اضافه می‌شود
      const [updated] = await this.prisma.$transaction([
        this.prisma.chargeOrder.update({
          where: { id: order.id },
          data: { status: 'approved', reviewedBy: admin.id, reviewedAt: new Date() },
        }),
        this.prisma.user.update({
          where: { id: order.userId },
          data: { walletBalance: { increment: order.charge } },
        }),
      ]);
      return { id: updated.id, status: updated.status, charged: order.charge };
    }

    // رد: دلیل برای کاربر ذخیره می‌شود
    const updated = await this.prisma.chargeOrder.update({
      where: { id: order.id },
      data: { status: 'rejected', rejectionReason: reason, reviewedBy: admin.id, reviewedAt: new Date() },
    });
    return { id: updated.id, status: updated.status, charged: 0 };
  }
}
