import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import { UploadsService } from '../uploads/uploads.service';
import { wallet as walletEnv } from '../common/config/env';
import type { AuthUser } from '../common/guards';
import type { GetPackageOrdersDto } from './dto';

/**
 * ─── بسته‌های اشتراک ایمچ (عضویت فروشنده ویژه) ───────────────────────────────
 *
 * مدل درآمدی دو لایه (خواسته مالک):
 *  • بسته رایگانِ همیشگی — ثبت تا ۱۰ محصول + درخواست خرید نامحدود؛
 *    اما «خریداران» (شماره تماس / خریداران پیشنهادی) دیده نمی‌شود.
 *  • بسته‌های پولی (۲/۶/۱۲ ماهه) — ثبت نامحدود محصول + دسترسی نامحدود به
 *    همه خریداران + نشان فروشنده ویژه + اولویت نمایش.
 *
 * پرداخت: کارت‌به‌کارت + فیش (عین B9) → تأیید ادمین در /admin/packages/* →
 * activePakageType کاربر روی پلن تنظیم و packageExpiresAt تمدید می‌شود.
 * انقضای گذشته عملاً رایگان است (effectivePakageType) — فیلد خام دست
 * نمی‌خورد تا با تمدید، باقیمانده اعتبار قبلی هدر نرود.
 */

/** پلن‌های اشتراک — قیمت‌ها حدود یک‌بیستم باسکول (خواسته مالک) */
export const MEMBERSHIP_PLANS = [
  { key: 'p2m', months: 2, amount: 199_000, title: 'دو ماهه', pakageType: 1 },
  { key: 'p6m', months: 6, amount: 499_000, title: 'شش ماهه', pakageType: 2, bestSeller: true },
  { key: 'p12m', months: 12, amount: 799_000, title: 'یک‌ساله', pakageType: 3 },
] as const;

export type MembershipPlanKey = (typeof MEMBERSHIP_PLANS)[number]['key'];

/** ظرفیت ثبت محصول بسته رایگان — قبلاً ۵ بود؛ خواسته مالک: ۱۰ */
export const FREE_PRODUCT_CAPACITY = 10;

/** ماه تجاری ۳۰ روزه — هم‌راستا با نردبان (LADDER_DURATION_MS) */
const MONTH_MS = 30 * 86_400_000;

/** حداکثر تراکنش‌های برگشتی در تاریخچه */
const ORDERS_LIMIT = 100;

const OID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * بسته مؤثر — انقضای گذشته/نبودِ بسته = رایگان (۰).
 * تابع خالص و بدون وابستگی تا products/buy-requests هم بدون حلقه ماژول
 * بتوانند گیت‌های ظرفیت/خریداران را دقیقاً مثل پنل محاسبه کنند.
 */
export function effectivePakageType(
  activePakageType: number,
  packageExpiresAt: Date | null | undefined,
): number {
  if (!activePakageType || activePakageType <= 0) return 0;
  if (!packageExpiresAt) return 0;
  return packageExpiresAt.getTime() > Date.now() ? activePakageType : 0;
}

@Injectable()
export class PackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  /** POST /packages/getPlans — عمومی: پلن‌ها + امکانات بسته رایگان (صفحه قیمتها) */
  getPlans() {
    return {
      plans: MEMBERSHIP_PLANS,
      cardNumber: walletEnv.CARD_NUMBER,
      cardOwner: walletEnv.CARD_OWNER,
      free: {
        productCapacity: FREE_PRODUCT_CAPACITY,
        canSeeBuyers: false,
        unlimitedBuyRequests: true,
      },
    };
  }

  /** بسته فعال + امکانات مؤثر کاربر — تک منبع گیت‌های سمت کلاینت */
  private async myPackage(userId: string) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { activePakageType: true, packageExpiresAt: true },
    });
    if (!me) throw AppError.notFound('حساب کاربری یافت نشد.');

    const active = effectivePakageType(me.activePakageType, me.packageExpiresAt);
    const pendingCount = await this.prisma.packageOrder.count({
      where: { userId, status: 'pending' },
    });
    return { me, active, pendingCount };
  }

  /** POST /packages/getMyPackage — وضعیت بسته من (پنل + گیت صفحات) */
  async getMyPackage(userId: string) {
    const { me, active, pendingCount } = await this.myPackage(userId);
    const expiresAt = me.packageExpiresAt && me.packageExpiresAt > new Date() ? me.packageExpiresAt : null;
    const daysLeft = expiresAt
      ? Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000))
      : null;
    return {
      /** ۰=رایگان ۱=دوماهه ۲=شش‌ماهه ۳=یک‌ساله (مؤثر — انقضا لحاظ شده) */
      pakageType: active,
      isActive: active > 0,
      expiresAt,
      daysLeft,
      pendingCount,
      features: {
        /** -1 = نامحدود */
        productCapacity: active > 0 ? -1 : FREE_PRODUCT_CAPACITY,
        canSeeBuyers: active > 0,
        unlimitedBuyRequests: true,
      },
    };
  }

  /** POST /packages/createPackageOrder (multipart: planKey + receipt) — فیش خرید بسته */
  async createPackageOrder(user: AuthUser, req: FastifyRequest) {
    // ۱) پلن + فیش — فقط این دو فیلد پذیرفته می‌شوند (عین B9)
    const { fields, files } = await this.uploads.readMultipartMulti(req, ['receipt']);
    const planKey = (fields.planKey || '').trim();
    const plan = MEMBERSHIP_PLANS.find((p) => p.key === planKey);
    if (!plan) {
      throw AppError.badRequest('بسته انتخابی نامعتبر است.', 'PACKAGE_INVALID');
    }
    const receipt = files.get('receipt');
    if (!receipt) {
      throw AppError.badRequest('تصویر فیش واریزی الزامی است.', 'RECEIPT_MISSING');
    }

    // ۲) سفارش (ردیف مرجع) → ۳) چسباندن فیش با جبران کامل در خطا
    const order = await this.prisma.packageOrder.create({
      data: { userId: user.id, planKey: plan.key, months: plan.months, amount: plan.amount },
    });
    try {
      await this.uploads.upload(
        user,
        { model: 'PackageOrder', modelId: order.id, fieldKey: 'receipt', replace: true },
        receipt,
      );
    } catch (err) {
      await this.uploads.removeAllForModel('PackageOrder', order.id).catch(() => undefined);
      await this.prisma.packageOrder.delete({ where: { id: order.id } }).catch(() => undefined);
      throw err;
    }

    return {
      orderId: order.id,
      planKey: plan.key,
      months: plan.months,
      amount: plan.amount,
      status: 'pending' as const,
    };
  }

  /** POST /packages/getMyPackageOrders — سفارش‌های خودم + وضعیت فیش‌ها */
  async getMyPackageOrders(userId: string) {
    const rows = await this.prisma.packageOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: ORDERS_LIMIT,
    });

    const orderIds = rows.map((r) => r.id);
    const files = orderIds.length
      ? await this.prisma.file.findMany({
          where: { relatedModel: 'PackageOrder', relatedId: { in: orderIds }, fieldKey: 'receipt' },
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
          planKey: r.planKey,
          months: r.months,
          amount: r.amount,
          rejectionReason: r.status === 'rejected' ? r.rejectionReason : null,
          reviewedAt: r.reviewedAt,
          startsAt: r.startsAt,
          expiresAt: r.expiresAt,
          createdAt: r.createdAt,
          receipt: receipt ? { url: receipt.url, thumbUrl: receipt.thumbUrl } : null,
        };
      }),
    };
  }

  // ─── ادمین (از AdminPackagesService مصرف می‌شود) ────────────────────────────

  /** POST /admin/packages/getPackageOrders — صف بررسی فیش‌های بسته */
  async getPackageOrders(dto: GetPackageOrdersDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));
    const where = { ...(dto.status ? { status: dto.status } : {}) };

    const [total, rows] = await Promise.all([
      this.prisma.packageOrder.count({ where }),
      this.prisma.packageOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, phone: true, userName: true, firstName: true, lastName: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const orderIds = rows.map((r) => r.id);
    const files = orderIds.length
      ? await this.prisma.file.findMany({
          where: { relatedModel: 'PackageOrder', relatedId: { in: orderIds }, fieldKey: 'receipt' },
          select: { id: true, relatedId: true, url: true, thumbUrl: true },
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
          planKey: r.planKey,
          months: r.months,
          amount: r.amount,
          rejectionReason: r.rejectionReason,
          reviewedAt: r.reviewedAt,
          startsAt: r.startsAt,
          expiresAt: r.expiresAt,
          createdAt: r.createdAt,
          user: {
            id: r.userId,
            phone: u?.phone ?? '',
            user_name: u?.userName ?? '',
            first_name: u?.firstName ?? '',
            last_name: u?.lastName ?? '',
          },
          receipt: receipt ?? null,
        };
      }),
    };
  }

  /**
   * POST /admin/packages/reviewPackageOrder — تأیید → اعمال/تمدید بسته؛ رد → دلیل.
   * تمدید = امتداد از انقضای زنده فعلی (اگر بسته فعال دارد)، وگرنه از الان.
   */
  async reviewPackageOrder(
    admin: AuthUser,
    dto: { orderId: string; approve: boolean; rejectionReason?: string },
  ) {
    if (!OID_RE.test(dto.orderId)) {
      throw AppError.notFound('سفارش بسته یافت نشد.');
    }
    const order = await this.prisma.packageOrder.findUnique({ where: { id: dto.orderId } });
    if (!order) throw AppError.notFound('سفارش بسته یافت نشد.');
    if (order.status !== 'pending') {
      throw AppError.conflict('این سفارش قبلاً بررسی شده است.', 'ALREADY_REVIEWED');
    }

    const plan = MEMBERSHIP_PLANS.find((p) => p.key === order.planKey);
    if (!plan) throw AppError.badRequest('پلن این سفارش معتبر نیست.', 'PACKAGE_INVALID');

    const reason = dto.rejectionReason?.trim();
    if (!dto.approve && !reason) {
      throw AppError.badRequest('دلیل رد شدن را وارد کنید.', 'REASON_REQUIRED');
    }

    if (dto.approve) {
      // مبنا: انقضای زنده فعلی (تمدید) یا اکنون (بسته تازه)
      const now = new Date();
      const buyer = await this.prisma.user.findUnique({
        where: { id: order.userId },
        select: { packageExpiresAt: true },
      });
      const base =
        buyer?.packageExpiresAt && buyer.packageExpiresAt > now ? buyer.packageExpiresAt : now;
      const expiresAt = new Date(base.getTime() + plan.months * MONTH_MS);

      const [updated] = await this.prisma.$transaction([
        this.prisma.packageOrder.update({
          where: { id: order.id },
          data: {
            status: 'approved',
            reviewedBy: admin.id,
            reviewedAt: now,
            startsAt: base,
            expiresAt,
          },
        }),
        this.prisma.user.update({
          where: { id: order.userId },
          data: { activePakageType: plan.pakageType, packageExpiresAt: expiresAt },
        }),
      ]);
      return { id: updated.id, status: updated.status, expiresAt };
    }

    const updated = await this.prisma.packageOrder.update({
      where: { id: order.id },
      data: { status: 'rejected', rejectionReason: reason, reviewedBy: admin.id, reviewedAt: new Date() },
    });
    return { id: updated.id, status: updated.status };
  }
}
