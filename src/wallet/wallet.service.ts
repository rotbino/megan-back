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

/** شارژ دلخواه (دکمه «سایر» — خواسته مالک ۳۱-۱۰):
 *  • حداقل ۴۰۰ هزار تومان — کمتر رد می‌شود.
 *  • ۴۰۰ هزار تا ۱ میلیون → ۳۰٪ شارژ اضافه؛ بیش از ۱ میلیون → ۵۰٪. */
export const CUSTOM_CHARGE_MIN = 400_000;
/** سقف منطقی شارژ دلخواه — جلوگیری از اشتباه سه‌رقمی در فیش */
export const CUSTOM_CHARGE_MAX = 100_000_000;
/** آستانه ۵۰٪ — بالای این مبلغ */
export const CUSTOM_CHARGE_TIER2_AT = 1_000_000;

/** درصد شارژ اضافه مبلغ دلخواه — ۳۰٪ تا ۱ میلیون، ۵۰٪ بالاتر */
export function customBonusPercent(amount: number): number {
  return amount > CUSTOM_CHARGE_TIER2_AT ? 50 : 30;
}

/** هزینه نردبان هر آگهی برای یک ماه — خواسته مالک (۳۰-۱۰): ۵۰ هزار تومان */
export const LADDER_MONTHLY_PRICE = 50_000;

/** حداکثر ماه نردبان (خواسته مالک ۳۱-۱۰: تا ۴ ماه) */
export const LADDER_MAX_MONTHS = 4;

/** مدت نردبان: ۳۰ روز در هر ماه */
const LADDER_MONTH_MS = 30 * 86_400_000;

/** حداکثر تراکنش‌های برگشتی در تاریخچه */
const TRANSACTIONS_LIMIT = 100;

const OID_RE = /^[0-9a-fA-F]{24}$/;

/** برچسب فارسی تعداد ماه — یک‌ماهه/دو ماهه/سه ماهه/چهار ماهه */
function monthsLabel(months: number): string {
  const n = Math.min(12, Math.max(1, Math.round(months)));
  return n === 1 ? 'یک‌ماهه' : n === 2 ? 'دو ماهه' : n === 3 ? 'سه ماهه' : 'چهار ماهه';
}

export interface WalletTransactionDto {
  id: string;
  title: string;
  amount: number;
  incoming: boolean;
  /** نوع تراکنش — «card» واریز کارت‌به‌کارت تأییدشده؛ «ladder» نردبان؛ «adjust» اصلاح ادمین.
   * آینده: «online» درگاه آنلاین — همین قرارداد، فقط مقدار جدید. */
  type: 'card' | 'ladder' | 'adjust';
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
    await this.reapElevatedFlags();
  }

  /**
   * پرچم «فروشنده ویژه» آگهی‌ها را با واقعیت بسته‌ها هم‌گام نگه می‌دارد:
   *  • مالکان بستهٔ فعال → isElevated=true (تأیید بسته فوری ست می‌کند؛ این
   *    پاک‌سازی برای آگهی‌های ثبت‌شده وسط دوره/حالت‌های جاافتاده است)
   *  • مالکانی که بسته‌شان منقضی شده → isElevated=false (ساعت شنی همه‌چیز)
   */
  private async reapElevatedFlags(): Promise<void> {
    try {
      const premiumUsers = await this.prisma.user.findMany({
        where: { activePakageType: { gt: 0 }, packageExpiresAt: { gt: new Date() } },
        select: { id: true },
      });
      const premiumIds = premiumUsers.map((u) => u.id);

      const [on, off] = await this.prisma.$transaction([
        // not:true (→ $ne) در مونگو اسنادِ «بدون فیلد» را هم می‌گیرد —
        // آگهی‌های مهاجرت‌شده قدیمی is_elevated صریح ندارند
        this.prisma.product.updateMany({
          where: { userId: { in: premiumIds }, isElevated: { not: true } },
          data: { isElevated: true },
        }),
        this.prisma.product.updateMany({
          where: {
            isElevated: true,
            ...(premiumIds.length > 0 ? { userId: { notIn: premiumIds } } : {}),
          },
          data: { isElevated: false },
        }),
      ]);
      if (on.count > 0 || off.count > 0) this.cache.invalidateTag('products');
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
      /** حداقل شارژ پکیجی — برابر هزینه نردبان یک‌ماهه (عین باسکول) */
      minCharge: LADDER_MONTHLY_PRICE,
      ladderMonthlyPrice: LADDER_MONTHLY_PRICE,
      ladderMaxMonths: LADDER_MAX_MONTHS,
      cardNumber: walletEnv.CARD_NUMBER,
      cardOwner: walletEnv.CARD_OWNER,
      packages: CHARGE_PACKAGES,
      /** قواعد شارژ دلخواه (دکمه «سایر») — فرانت همان را نمایش می‌دهد */
      custom: {
        min: CUSTOM_CHARGE_MIN,
        max: CUSTOM_CHARGE_MAX,
        tier2At: CUSTOM_CHARGE_TIER2_AT,
        tier1Percent: 30,
        tier2Percent: 50,
      },
    };
  }

  /** POST /wallet/getWalletTransactions — فقط تراکنش‌های «قطعی‌شده»:
   *  • شارژهای کارت‌به‌کارت «تأییدشده» (نوع card) + نردبان‌ها + اصلاح‌های ادمین.
   *  • شارژهای در انتظار/ردشده اصلاً اینجا نمی‌آیند — تب «کارت به کارت» (getMyChargeOrders)
   *    محل زندگی آنهاست تا کاربر وضعیت فیش خود را با دلیل رد پیگیری کند.
   *  (خواسته مالک TEST-D6 — کیف پول مرتب: تراکنش = واقعی، کارت‌به‌کارت = صف فیش‌ها) */
  async getWalletTransactions(userId: string): Promise<{ items: WalletTransactionDto[] }> {
    const [charges, ladders, adjustments] = await Promise.all([
      this.prisma.chargeOrder.findMany({
        where: { userId, status: 'approved' },
        orderBy: { createdAt: 'desc' },
        take: TRANSACTIONS_LIMIT,
        select: { id: true, charge: true, reviewedAt: true, createdAt: true },
      }),
      this.prisma.ladderOrder.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: TRANSACTIONS_LIMIT,
        select: { id: true, productId: true, amount: true, months: true, createdAt: true },
      }),
      this.prisma.walletAdjustment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: TRANSACTIONS_LIMIT,
        select: { id: true, amount: true, reason: true, createdAt: true },
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
        title: 'شارژ کیف پول — کارت به کارت',
        amount: c.charge,
        incoming: true,
        type: 'card' as const,
        at: c.reviewedAt ?? c.createdAt,
      })),
      ...ladders.map((l) => ({
        id: `ladder:${l.id}`,
        title: `نردبان «${productName.get(l.productId) ?? 'آگهی'}» — ${monthsLabel(l.months)}`,
        amount: l.amount,
        incoming: false,
        type: 'ladder' as const,
        at: l.createdAt,
      })),
      ...adjustments.map((a) => ({
        id: `adjust:${a.id}`,
        title: `اصلاح کیف پول — ${a.reason}`,
        amount: Math.abs(a.amount),
        incoming: a.amount > 0,
        type: 'adjust' as const,
        at: a.createdAt,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    return { items };
  }

  /** POST /wallet/getMyChargeOrders — فیش‌های کارت‌به‌کارت خودِ کاربر (تب «کارت به کارت»).
   * در انتظار/تأییدشده/ردشده + دلیل رد + بندانگشتی فیش — تا کاربر بداند چه شده و چه کند. */
  async getMyChargeOrders(userId: string) {
    const rows = await this.prisma.chargeOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: TRANSACTIONS_LIMIT,
    });

    const orderIds = rows.map((r) => r.id);
    const files = orderIds.length
      ? await this.prisma.file.findMany({
          where: { relatedModel: 'ChargeOrder', relatedId: { in: orderIds }, fieldKey: 'receipt' },
          select: { relatedId: true, url: true, thumbUrl: true },
        })
      : [];
    const fileMap = new Map(files.map((f) => [f.relatedId!, f]));

    return {
      items: rows.map((r) => {
        const receipt = fileMap.get(r.id);
        return {
          id: r.id,
          status: r.status,
          packageKey: r.packageKey,
          amount: r.amount,
          bonusPercent: r.bonusPercent,
          charge: r.charge,
          rejectionReason: r.status === 'rejected' ? r.rejectionReason : null,
          reviewedAt: r.reviewedAt,
          createdAt: r.createdAt,
          receipt: receipt ? { url: receipt.url, thumbUrl: receipt.thumbUrl } : null,
        };
      }),
    };
  }

  /** POST /wallet/createChargeOrder (multipart: packageKey [+ amount] + receipt) —
   *  فیش واریزی. packageKey='custom' + amount = شارژ دلخواه (دکمه «سایر»):
   *  حداقل ۴۰۰ هزار؛ ۳۰٪ شارژ اضافه تا ۱ میلیون و ۵۰٪ بالاتر (خواسته مالک ۳۱-۱۰). */
  async createChargeOrder(user: AuthUser, req: FastifyRequest) {
    // ۱) پکیج + مبلغ — اول اعتبار پکیج/مبلغ، بعد فیش (پیام درست به کاربر)
    const { fields, files } = await this.uploads.readMultipartMulti(req, ['receipt']);
    const packageKey = (fields.packageKey || '').trim();

    let amount: number;
    let bonusPercent: number;
    if (packageKey === 'custom') {
      // شارژ دلخواه — «سایر»
      amount = Math.round(Number(fields.amount));
      if (!Number.isFinite(amount) || amount < CUSTOM_CHARGE_MIN) {
        throw AppError.badRequest(
          `حداقل مبلغ شارژ دلخواه ${CUSTOM_CHARGE_MIN.toLocaleString('fa-IR')} تومان است.`,
          'CUSTOM_CHARGE_MIN',
        );
      }
      if (amount > CUSTOM_CHARGE_MAX) {
        throw AppError.badRequest(
          `حداکثر مبلغ شارژ دلخواه ${CUSTOM_CHARGE_MAX.toLocaleString('fa-IR')} تومان است.`,
          'CUSTOM_CHARGE_MAX',
        );
      }
      bonusPercent = customBonusPercent(amount);
    } else {
      const pkg = CHARGE_PACKAGES.find((p) => p.key === packageKey);
      if (!pkg) {
        throw AppError.badRequest('پکیج شارژ نامعتبر است.', 'PACKAGE_INVALID');
      }
      amount = pkg.amount;
      bonusPercent = pkg.bonusPercent;
    }
    const charge = Math.round(amount * (1 + bonusPercent / 100));

    const receipt = files.get('receipt');
    if (!receipt) {
      throw AppError.badRequest('تصویر فیش واریزی الزامی است.', 'RECEIPT_MISSING');
    }

    // ۲) سفارش (ردیف مرجع) → ۳) چسباندن فیش با اعتبارسنجی کامل uploads
    //    (عین B6: اسلات تک‌فایلی receipt با replace + جبران کامل در خطا)
    const order = await this.prisma.chargeOrder.create({
      data: {
        userId: user.id,
        packageKey,
        amount,
        bonusPercent,
        charge,
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
      packageKey,
      amount,
      bonusPercent,
      charge,
      status: 'pending' as const,
    };
  }

  // ─── نردبان ─────────────────────────────────────────────────────────────────

  /** POST /wallet/ladderProduct — نردبان ۱ تا ۴ ماه از کیف پول (اتمیک).
   *  پیش‌فرض ۱ ماه؛ اگر موجودی برای ماه‌های انتخابی کافی نباشد پیام دقیق همان
   * بازه می‌آید: «شارژ برای دو ماهه کافی نیست» (خواسته مالک ۳۱-۱۰). */
  async ladderProduct(user: AuthUser, dto: LadderProductDto) {
    const months = Math.min(LADDER_MAX_MONTHS, Math.max(1, Math.round(dto.months ?? 1)));
    const cost = LADDER_MONTHLY_PRICE * months;
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
    const insufficient = (needed: number, label: string) =>
      me && me.walletBalance < needed
        ? `موجودی کیف پول برای نردبان ${label} کافی نیست — برای این گزینه ${needed.toLocaleString(
            'fa-IR',
          )} تومان شارژ لازم دارید.`
        : null;
    const msg = insufficient(cost, monthsLabel(months));
    if (!me || msg) {
      throw AppError.badRequest(
        msg ?? 'موجودی کیف پول برای نردبان کافی نیست — ابتدا کیف پول خود را شارژ کنید.',
        'WALLET_INSUFFICIENT',
      );
    }

    // تمدید = امتداد از انقضای فعلی (اگر هنوز زنده است)، وگرنه از الان
    const now = new Date();
    const currentExpiry = product.ladderExpiresAt && product.ladderExpiresAt > now ? product.ladderExpiresAt : null;
    const expiresAt = new Date((currentExpiry ?? now).getTime() + months * LADDER_MONTH_MS);

    try {
      await this.prisma.$transaction([
        // گارد شرطی اتمیک: فقط اگر موجودی هنوز کافی باشد کم می‌شود (P2025 → کافی نیست)
        this.prisma.user.update({
          where: { id: user.id, walletBalance: { gte: cost } },
          data: { walletBalance: { decrement: cost } },
        }),
        this.prisma.product.update({
          where: { id: product.id },
          data: { isLadder: true, ladderExpiresAt: expiresAt },
        }),
        this.prisma.ladderOrder.create({
          data: {
            productId: product.id,
            userId: user.id,
            amount: cost,
            months,
            startsAt: now,
            expiresAt,
          },
        }),
      ]);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw AppError.badRequest(
          `موجودی کیف پول برای نردبان ${monthsLabel(months)} کافی نیست — برای این گزینه ${cost.toLocaleString(
            'fa-IR',
          )} تومان شارژ لازم دارید.`,
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
      months,
      ladderExpiresAt: expiresAt,
      balance: after?.walletBalance ?? me.walletBalance - cost,
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
