import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService } from '../common/cache/cache.module';
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
 *  • بسته‌های پولی (از جدول Plan — ادمین تعریف/ویرایش می‌کند) — ثبت نامحدود
 *    محصول + دسترسی نامحدود به همه خریداران + نشان فروشنده ویژه.
 *
 * کمپین فروش (خواسته مالک ۳۱-۱۰):
 *  • زمانی — درصد ثابت تا تاریخ پایان (مثلاً جشنواره ۵۰٪ آغاز فعالیت).
 *  • تعدادی — پله‌ای بر اساس شمار خریداران؛ تخفیف جاری از purchaseCount
 *    محاسبه می‌شود و ادمین می‌تواند manualDiscountPercent را دستی ست کند.
 *  • عنوان/شعار کمپین بالای بسته‌ها در صفحه قیمت‌ها نمایش داده می‌شود؛
 *    قیمت نهایی = قیمت پایه × (۱ − درصد تخفیف جاری).
 *
 * پرداخت: کارت‌به‌کارت + فیش (عین B9) → تأیید ادمین در /admin/packages/* →
 * activePakageType کاربر روی پلن تنظیم و packageExpiresAt تمدید می‌شود
 * (خرید در حین بسته فعال = رزرو — امتداد از انقضای فعلی؛ مالکان فعلی از
 * جشنواره‌ها محروم نمی‌شوند).
 */

/** بذر پیش‌فرض بسته‌ها — فقط بار اول/خالی بودن جدول. قیمت پایه دوبرابر قیمت
 *  قبلی است و کمپین ۵۰٪ آغاز فعالیت آن را به قیمت قبلی برمی‌گرداند (خواسته
 *  مالک ۳۱-۱۰: «قیمت‌ها دو برابر + ۵۰٪ تخفیف = قیمت فعلی»). */
export const SEED_PLANS = [
  {
    key: 'p2m',
    months: 2,
    amount: 398_000,
    title: 'دو ماهه',
    pakageType: 1,
    bestSeller: false,
    sortOrder: 1,
  },
  {
    key: 'p6m',
    months: 6,
    amount: 998_000,
    title: 'شش ماهه',
    pakageType: 2,
    bestSeller: true,
    sortOrder: 2,
  },
  {
    key: 'p12m',
    months: 12,
    amount: 1_598_000,
    title: 'یک‌ساله',
    pakageType: 3,
    bestSeller: false,
    sortOrder: 3,
  },
] as const;

/** ویژگی‌های پیش‌فرض بسته‌های پولی — ردیف‌های کارت قیمت */
export const DEFAULT_PLAN_FEATURES = [
  'ثبت تعداد نامحدود محصول',
  'دسترسی نامحدود به همه خریداران',
  'ثبت درخواست خرید نامحدود',
  'درج نشان فروشنده ویژه روی محصولات و پروفایل',
  'نمایش محصولات بالاتر از رقبا',
  'اولویت بررسی و پشتیبانی ویژه',
];

/** ظرفیت ثبت محصول بسته رایگان — قبلاً ۵ بود؛ خواسته مالک: ۱۰ */
export const FREE_PRODUCT_CAPACITY = 10;

/** ماه تجاری ۳۰ روزه — هم‌راستا با نردبان (LADDER_DURATION_MS) */
const MONTH_MS = 30 * 86_400_000;

/** حداکثر تراکنش‌های برگشتی در تاریخچه */
const ORDERS_LIMIT = 100;

const OID_RE = /^[0-9a-fA-F]{24}$/;

/** پله کمپین تعدادی — to=null یعنی تا پایان کمپین */
export interface CampaignTier {
  from: number;
  to: number | null;
  percent: number;
}

/** شمار مؤثر خریداران — بیشینهٔ خرید واقعی و عدد دستی/نمایشی ادمین
 *  (خواسته مالک ۳۱-۱۰: «بتونم الکی ست کنم چند نفر خریدن»). */
export function effectivePurchaseCount(
  real: number,
  manual: number | null | undefined,
): number {
  return Math.max(real, manual ?? 0);
}

/** گیرهٔ درصد در بازهٔ ۰ تا ۱۰۰ */
function clampPercent(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** شکل امن خوانده‌شده tiers از Json */
export function readTiers(raw: unknown): CampaignTier[] {
  if (!Array.isArray(raw)) return [];
  const tiers: CampaignTier[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const o = t as Record<string, unknown>;
    const from = Number(o.from);
    const percent = Number(o.percent);
    const to = o.to == null ? null : Number(o.to);
    if (!Number.isFinite(from) || !Number.isFinite(percent)) continue;
    if (to != null && !Number.isFinite(to)) continue;
    if (from < 1 || percent < 0 || percent > 100) continue;
    if (to != null && to < from) continue;
    tiers.push({ from, to, percent: Math.round(percent) });
  }
  return tiers.sort((a, b) => a.from - b.from);
}

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

/** ردیف بسته برای خروجی عمومی — قیمت پایه + تخفیف جاری + قیمت نهایی */
export interface PublicPlan {
  key: string;
  title: string;
  months: number;
  /** قیمت پایه (خط‌خورده در UI اگر تخفیف فعال باشد) */
  amount: number;
  /** درصد تخفیف جاری کمپین — ۰ = بدون کمپین */
  discountPercent: number;
  /** قیمت نهایی قابل پرداخت = amount × (۱ − discountPercent) */
  finalAmount: number;
  pakageType: number;
  bestSeller: boolean;
  features: string[];
}

/** کمپین فعال + تخفیف جاری — شکل خروجی عمومی */
export interface ActiveCampaignInfo {
  id: string;
  title: string;
  description: string | null;
  type: 'time' | 'quantity';
  /** درصد جاری — در تعدادی از پله/override دستی، در زمانی همان discountPercent */
  discountPercent: number;
  endsAt: Date | null;
  /** شمار مؤثر خریداران (بیشینهٔ واقعی/دستی) — عددی که به کاربر نمایش داده می‌شود */
  purchaseCount: number;
  /** پله جاری (فقط تعدادی) + ظرفیت باقی‌مانده برای گزارش «فقط N نفر جا داره» */
  currentTier: {
    from: number;
    to: number | null;
    percent: number;
    boughtInTier: number;
    /** جاهای باقی‌مانده همین پله — null = بی‌پایان (تا پایان کمپین) */
    spotsLeft: number | null;
  } | null;
  tiers: CampaignTier[];
  /** درصد عمومی پس از اتمام پله‌های محدود — تا پایان کمپین (خواسته مالک ۳۱-۱۰) */
  finalPercent: number | null;
}

@Injectable()
export class PackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly cache: CacheService,
  ) {}

  // ─── بسته‌ها (جدول Plan) ──────────────────────────────────────────────────

  /** بذر اولیه — فقط وقتی جدول خالی است (idempotent) */
  private async ensureSeeded(): Promise<void> {
    const count = await this.prisma.plan.count();
    if (count > 0) return;
    await this.prisma.plan.createMany({
      data: SEED_PLANS.map((p) => ({
        ...p,
        features: DEFAULT_PLAN_FEATURES,
        isActive: true,
        soldCount: 0,
      })),
    });
  }

  /** بسته‌های فعال از DB — مرتب بر اساس sortOrder؛ خالی → بذر می‌ریزد */
  private async activePlans() {
    await this.ensureSeeded();
    return this.prisma.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  /** یافتن بسته با key — فعال یا غیرفعال (برای تاریخچه سفارش‌ها) */
  async findPlanByKey(key: string) {
    return this.prisma.plan.findUnique({ where: { key } });
  }

  // ─── کمپین‌ها ─────────────────────────────────────────────────────────────

  /** کمپین فعالِ جاری — جدیدترین کمپینِ فعال که شروع شده و منقضی نشده */
  async activeCampaign() {
    const now = new Date();
    return this.prisma.salesCampaign.findFirst({
      where: {
        isActive: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** پله جاری کمپین تعدادی بر اساس شمار خرید — خرید بعدی = count+1 */
  static tierFor(tiers: CampaignTier[], nextBuyerIndex: number): CampaignTier | null {
    for (const t of tiers) {
      if (nextBuyerIndex >= t.from && (t.to == null || nextBuyerIndex <= t.to)) return t;
    }
    return null;
  }

  /**
   * گزارش پله جاری برای شمار مؤثر خریداران — شامل جاهای باقی‌مانده
   * (خواسته مالک ۳۱-۱۰: «بنویسه ۹ نفر خریدن و تخفیف ۷۰٪ فقط یک نفر جا داره»).
   * بعد از اتمام پله‌های محدود، اگر finalPercent تعریف شده باشد پلهٔ عمومی
   * «تا پایان کمپین» سنتز می‌شود.
   */
  static tierReport(
    tiers: CampaignTier[],
    finalPercent: number | null,
    count: number,
  ): ActiveCampaignInfo['currentTier'] {
    if (tiers.length === 0) return null;
    let tier = PackagesService.tierFor(tiers, count + 1);
    if (!tier && finalPercent != null) {
      const lastTo = tiers[tiers.length - 1].to ?? 0;
      tier = { from: lastTo + 1, to: null, percent: clampPercent(finalPercent) };
    }
    if (!tier) return null;
    const boughtInTier = Math.max(0, count - (tier.from - 1));
    const spotsLeft = tier.to == null ? null : Math.max(0, tier.to - count);
    return { ...tier, boughtInTier, spotsLeft };
  }

  /** درصد تخفیف جاری کمپین — override دستی مقدم بر محاسبه پله‌ای.
   *  شمار خریداران مؤثر = بیشینهٔ واقعی/دستی است تا فوریت دستی ادمین هم
   *  روی تعیین پله خرید بعدی اثر بگذارد. */
  currentPercent(
    campaign: {
      type: string;
      discountPercent: number;
      manualDiscountPercent: number | null;
      finalPercent?: number | null;
      manualPurchaseCount?: number | null;
      tiers: Prisma.JsonValue | null;
    },
    purchaseCount: number,
  ): number {
    if (campaign.manualDiscountPercent != null) {
      return clampPercent(campaign.manualDiscountPercent);
    }
    if (campaign.type === 'quantity') {
      const count = effectivePurchaseCount(purchaseCount, campaign.manualPurchaseCount);
      const tier = PackagesService.tierFor(readTiers(campaign.tiers), count + 1);
      if (tier) return tier.percent;
      // بعد از اتمام تعداد همهٔ پله‌های محدود → درصد عمومی تا پایان کمپین
      // (خواسته مالک ۳۱-۱۰)؛ اگر تعریف نشده باشد تخفیف پله‌ای تمام می‌شود.
      return campaign.finalPercent != null ? clampPercent(campaign.finalPercent) : 0;
    }
    return clampPercent(campaign.discountPercent);
  }

  /** شکل عمومی کمپین فعال — برای getPlans و getMyPackage */
  private campaignInfo(
    c: {
      id: string;
      title: string;
      description: string | null;
      type: string;
      discountPercent: number;
      manualDiscountPercent: number | null;
      finalPercent: number | null;
      manualPurchaseCount: number | null;
      endsAt: Date | null;
      tiers: Prisma.JsonValue | null;
      purchaseCount: number;
    } | null,
  ): ActiveCampaignInfo | null {
    if (!c) return null;
    const tiers = readTiers(c.tiers);
    const count = effectivePurchaseCount(c.purchaseCount, c.manualPurchaseCount);
    const percent = this.currentPercent(c, count);
    const currentTier =
      c.type === 'quantity' ? PackagesService.tierReport(tiers, c.finalPercent, count) : null;
    return {
      id: c.id,
      title: c.title,
      description: c.description,
      type: c.type === 'quantity' ? 'quantity' : 'time',
      discountPercent: percent,
      endsAt: c.endsAt,
      purchaseCount: count,
      currentTier,
      tiers,
      finalPercent: c.finalPercent ?? null,
    };
  }

  // ─── عمومی ────────────────────────────────────────────────────────────────

  /** POST /packages/getPlans — عمومی: بسته‌ها (با تخفیف جاری) + کمپین + کارت واریز */
  async getPlans() {
    const [plans, campaign] = await Promise.all([this.activePlans(), this.activeCampaign()]);
    const info = this.campaignInfo(campaign);
    const percent = info?.discountPercent ?? 0;

    const publicPlans: PublicPlan[] = plans.map((p) => ({
      key: p.key,
      title: p.title,
      months: p.months,
      amount: p.amount,
      discountPercent: percent,
      finalAmount: Math.round((p.amount * (100 - percent)) / 100),
      pakageType: p.pakageType,
      bestSeller: p.bestSeller,
      features: readFeatures(p.features),
    }));

    return {
      plans: publicPlans,
      campaign: info,
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
      select: {
        activePakageType: true,
        packageExpiresAt: true,
        packageStartedAt: true,
      },
    });
    if (!me) throw AppError.notFound('حساب کاربری یافت نشد.');

    const active = effectivePakageType(me.activePakageType, me.packageExpiresAt);
    const pendingCount = await this.prisma.packageOrder.count({
      where: { userId, status: 'pending' },
    });
    return { me, active, pendingCount };
  }

  /** POST /packages/getMyPackage — وضعیت بسته من (پنل + گیت صفحات + نمودار دایره‌ای) */
  async getMyPackage(userId: string) {
    const { me, active, pendingCount } = await this.myPackage(userId);
    const expiresAt =
      me.packageExpiresAt && me.packageExpiresAt > new Date() ? me.packageExpiresAt : null;

    // دوره جاری برای نمودار دایره‌ای «ایمچ من»: کل = انقضا − شروع.
    // startedAt قدیمی‌ها null است → از سطح بسته برش می‌زنیم (۲/۶/۱۲ ماه).
    let startedAt = me.packageStartedAt;
    let totalDays: number | null = null;
    if (expiresAt) {
      const fallbackMonths = me.activePakageType === 3 ? 12 : me.activePakageType === 2 ? 6 : 2;
      if (!startedAt || startedAt >= expiresAt) {
        startedAt = new Date(expiresAt.getTime() - fallbackMonths * MONTH_MS);
      }
      totalDays = Math.max(
        1,
        Math.round((expiresAt.getTime() - startedAt.getTime()) / 86_400_000),
      );
    }
    const daysLeft = expiresAt
      ? Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000))
      : null;

    // عنوان بسته جاری از جدول Plan (برای «اشتراک {عنوان}»)
    let planTitle: string | null = null;
    if (active > 0) {
      const plan = await this.prisma.plan.findFirst({
        where: { pakageType: active, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      planTitle = plan?.title ?? null;
    }

    return {
      /** ۰=رایگان ۱=دوماهه ۲=شش‌ماهه ۳=یک‌ساله (مؤثر — انقضا لحاظ شده) */
      pakageType: active,
      isActive: active > 0,
      expiresAt,
      startedAt: active > 0 ? startedAt : null,
      totalDays,
      daysLeft,
      planTitle,
      pendingCount,
      features: {
        /** -1 = نامحدود */
        productCapacity: active > 0 ? -1 : FREE_PRODUCT_CAPACITY,
        canSeeBuyers: active > 0,
        unlimitedBuyRequests: true,
      },
    };
  }

  /** POST /packages/createPackageOrder (multipart: planKey + receipt) — فیش خرید بسته.
   *  تخفیف کمپین جاری snapshot می‌شود؛ مبلغ قابل پرداخت = قیمت نهایی. */
  async createPackageOrder(user: AuthUser, req: FastifyRequest) {
    // ۱) بسته + فیش — فقط این دو فیلد پذیرفته می‌شوند (عین B9)
    const { fields, files } = await this.uploads.readMultipartMulti(req, ['receipt']);
    const planKey = (fields.planKey || '').trim();
    const plan = await this.findPlanByKey(planKey);
    if (!plan || !plan.isActive) {
      throw AppError.badRequest('بسته انتخابی نامعتبر است.', 'PACKAGE_INVALID');
    }
    const receipt = files.get('receipt');
    if (!receipt) {
      throw AppError.badRequest('تصویر فیش واریزی الزامی است.', 'RECEIPT_MISSING');
    }

    // تخفیف کمپین جاری — snapshot روی سفارش
    const campaign = await this.activeCampaign();
    const percent = campaign ? this.currentPercent(campaign, campaign.purchaseCount) : 0;
    const finalAmount = Math.round((plan.amount * (100 - percent)) / 100);

    // ۲) سفارش (ردیف مرجع) → ۳) چسباندن فیش با جبران کامل در خطا
    //    شمارنده‌های جذب (کمپین + بسته) اتمیک با سفارش بالا می‌روند
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.packageOrder.create({
        data: {
          userId: user.id,
          planKey: plan.key,
          months: plan.months,
          amount: finalAmount,
          baseAmount: plan.amount,
          discountPercent: percent,
          campaignId: campaign?.id ?? null,
          campaignTitle: percent > 0 && campaign ? campaign.title : null,
        },
      });
      if (campaign) {
        await tx.salesCampaign.update({
          where: { id: campaign.id },
          data: { purchaseCount: { increment: 1 } },
        });
      }
      await tx.plan.update({
        where: { id: plan.id },
        data: { soldCount: { increment: 1 } },
      });
      return created;
    });

    try {
      await this.uploads.upload(
        user,
        { model: 'PackageOrder', modelId: order.id, fieldKey: 'receipt', replace: true },
        receipt,
      );
    } catch (err) {
      await this.uploads.removeAllForModel('PackageOrder', order.id).catch(() => undefined);
      // جبران شمارنده‌ها + سفارش (هرکدام مستقل — خطای یکی نباید بقیه را بگذراند)
      await this.prisma.packageOrder.delete({ where: { id: order.id } }).catch(() => undefined);
      if (campaign) {
        await this.prisma.salesCampaign
          .update({ where: { id: campaign.id }, data: { purchaseCount: { decrement: 1 } } })
          .catch(() => undefined);
      }
      await this.prisma.plan
        .update({ where: { id: plan.id }, data: { soldCount: { decrement: 1 } } })
        .catch(() => undefined);
      throw err;
    }

    return {
      orderId: order.id,
      planKey: plan.key,
      months: plan.months,
      amount: finalAmount,
      baseAmount: plan.amount,
      discountPercent: percent,
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
          baseAmount: r.baseAmount,
          discountPercent: r.discountPercent,
          campaignTitle: r.campaignTitle,
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
          baseAmount: r.baseAmount,
          discountPercent: r.discountPercent,
          campaignTitle: r.campaignTitle,
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
   * تمدید/رزرو = امتداد از انقضای زنده فعلی (اگر بسته فعال دارد)، وگرنه از الان.
   * packageStartedAT روی مبنا ست می‌شود تا نمودار دایره‌ای «ایمچ من» دوره را
   * کامل نشان دهد.
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

    // بسته از DB (یا بذر) — سفارش‌های قدیمی هم پوشیده می‌شوند
    let plan = await this.findPlanByKey(order.planKey);
    if (!plan) {
      const seed = SEED_PLANS.find((p) => p.key === order.planKey);
      if (!seed) throw AppError.badRequest('پلن این سفارش معتبر نیست.', 'PACKAGE_INVALID');
      plan = { ...seed, id: '', features: null, isActive: true, soldCount: 0, createdAt: new Date(), updatedAt: new Date() };
    }

    const reason = dto.rejectionReason?.trim();
    if (!dto.approve && !reason) {
      throw AppError.badRequest('دلیل رد شدن را وارد کنید.', 'REASON_REQUIRED');
    }

    if (dto.approve) {
      // مبنا: انقضای زنده فعلی (تمدید/رزرو) یا اکنون (بسته تازه)
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
          data: {
            activePakageType: plan.pakageType,
            packageExpiresAt: expiresAt,
            packageStartedAt: base,
          },
        }),
        // فروشنده ویژه شد — همه آگهی‌های تاییدشده‌اش elevated می‌شوند تا در
        // سورت «مرتبط‌ترین» بالاتر از رقبا دیده شوند (خواسته مالک ۳۰-۱۰)
        this.prisma.product.updateMany({
          where: { userId: order.userId, status: 'confirmed' },
          data: { isElevated: true },
        }),
      ]);
      // کش لیست‌ها بیات شود — ترتیب نمایش عوض شده
      this.cache.invalidateTag('products');
      return { id: updated.id, status: updated.status, expiresAt, startsAt: base };
    }

    const updated = await this.prisma.packageOrder.update({
      where: { id: order.id },
      data: { status: 'rejected', rejectionReason: reason, reviewedBy: admin.id, reviewedAt: new Date() },
    });
    return { id: updated.id, status: updated.status };
  }
}

/** خواندن امن features (Json) — رشته[] */
export function readFeatures(raw: unknown): string[] {
  if (!Array.isArray(raw)) return DEFAULT_PLAN_FEATURES;
  return raw.filter((f): f is string => typeof f === 'string' && f.trim().length > 0);
}
