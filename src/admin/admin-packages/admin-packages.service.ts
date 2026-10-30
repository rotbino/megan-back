import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.module';
import { AppError } from '../../common/errors/app-error';
import { PackagesService, readTiers, type CampaignTier } from '../../packages/packages.service';
import {
  GetAdminPackageOrdersDto,
  ReviewAdminPackageOrderDto,
  UpsertPlanDto,
  DeletePlanDto,
  GetCampaignsDto,
  UpsertCampaignDto,
  DeleteCampaignDto,
  SetCampaignDiscountDto,
} from './dto';

const OID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * مدیریت بسته‌های اشتراک و کمپین‌های فروش (admin/packages/*) — خواسته مالک ۳۱-۱۰:
 *  • بسته‌ها: تعریف/ویرایش کامل (قیمت، مدت، عنوان، ویژگی‌ها) — قیمت دیگر ثابت نیست.
 *  • کمپین‌ها: زمانی (٪ ثابت تا پایان) و تعدادی (پله‌ای: ۱۰ نفر اول ۷۰٪، …) +
 *    تغییر دستی درصد جاری + آمار جذب هر کمپین/بسته.
 * منطق صف و بازبینی سفارش‌ها از PackagesService مصرف می‌شود — کپی نمی‌شود.
 */
@Injectable()
export class AdminPackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly packages: PackagesService,
  ) {}

  // ─── سفارش‌های بسته (صف فیش‌ها) ───────────────────────────────────────────

  /** POST /admin/packages/getPackageOrders — صف فیش‌های بسته با فیلتر وضعیت */
  async getPackageOrders(dto: GetAdminPackageOrdersDto) {
    return this.packages.getPackageOrders({
      status: dto.status,
      page: dto.page,
      perPage: dto.perPage,
    });
  }

  /**
   * POST /admin/packages/reviewPackageOrder — تأیید → بسته فعال/تمدید می‌شود؛
   * رد → دلیل. reviewedBy = شناسه ادمین؛ username به‌عنوان phone ساختگی
   * تا شکل AuthUser کامل بماند (همان قرارداد A5).
   */
  async reviewPackageOrder(adminId: string, adminUsername: string, dto: ReviewAdminPackageOrderDto) {
    return this.packages.reviewPackageOrder(
      { id: adminId, phone: adminUsername, role: 'ADMIN' },
      { orderId: dto.orderId, approve: dto.approve, rejectionReason: dto.rejectionReason },
    );
  }

  // ─── مدیریت بسته‌ها (CRUD) ────────────────────────────────────────────────

  /** POST /admin/packages/getPlans — همه بسته‌ها (فعال/غیرفعال) + آمار فروش */
  async getPlans() {
    const plans = await this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } });
    const orderCounts = await this.prisma.packageOrder.groupBy({
      by: ['planKey'],
      _count: { _all: true },
    });
    const countMap = new Map(orderCounts.map((c) => [c.planKey, c._count._all]));
    return {
      items: plans.map((p) => ({
        id: p.id,
        key: p.key,
        title: p.title,
        months: p.months,
        amount: p.amount,
        pakageType: p.pakageType,
        bestSeller: p.bestSeller,
        features: Array.isArray(p.features) ? (p.features as string[]) : [],
        isActive: p.isActive,
        sortOrder: p.sortOrder,
        /** تعداد جذب این بسته (سفارش ثبت‌شده) */
        soldCount: p.soldCount,
        orderCount: countMap.get(p.key) ?? 0,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    };
  }

  /** POST /admin/packages/upsertPlan — ساخت/ویرایش بسته (id خالی = ساخت) */
  async upsertPlan(dto: UpsertPlanDto) {
    const key = dto.key.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,20}$/.test(key)) {
      throw AppError.badRequest(
        'کلید بسته فقط حروف انگلیسی کوچک، عدد و _ است (۲ تا ۲۰ نویسه).',
        'PLAN_KEY_INVALID',
      );
    }
    if (dto.amount < 10_000 || dto.amount > 1_000_000_000) {
      throw AppError.badRequest('قیمت بسته باید بین ۱۰ هزار تا ۱ میلیارد تومان باشد.', 'PLAN_AMOUNT_INVALID');
    }
    if (dto.months < 1 || dto.months > 36) {
      throw AppError.badRequest('مدت بسته باید بین ۱ تا ۳۶ ماه باشد.', 'PLAN_MONTHS_INVALID');
    }
    if (dto.pakageType < 1 || dto.pakageType > 3) {
      throw AppError.badRequest('سطح بسته باید ۱ (دو ماهه)، ۲ (شش ماهه) یا ۳ (یک‌ساله) باشد.', 'PLAN_TYPE_INVALID');
    }

    const data = {
      key,
      title: dto.title.trim(),
      months: dto.months,
      amount: dto.amount,
      pakageType: dto.pakageType,
      bestSeller: dto.bestSeller,
      features: dto.features.map((f) => f.trim()).filter(Boolean),
      isActive: dto.isActive,
      sortOrder: dto.sortOrder,
    };

    // یکتایی key/سطح
    if (dto.id) {
      if (!OID_RE.test(dto.id)) throw AppError.notFound('بسته یافت نشد.');
      const existing = await this.prisma.plan.findUnique({ where: { id: dto.id } });
      if (!existing) throw AppError.notFound('بسته یافت نشد.');
      const dup = await this.prisma.plan.findFirst({ where: { key, id: { not: dto.id } } });
      if (dup) throw AppError.conflict(`کلید «${key}» قبلاً برای بسته دیگری ثبت شده است.`, 'PLAN_KEY_DUP');
      const plan = await this.prisma.plan.update({ where: { id: dto.id }, data });
      return { id: plan.id, key: plan.key, created: false };
    }

    const dup = await this.prisma.plan.findUnique({ where: { key } });
    if (dup) throw AppError.conflict(`کلید «${key}» قبلاً ثبت شده است.`, 'PLAN_KEY_DUP');
    const plan = await this.prisma.plan.create({ data });
    return { id: plan.id, key: plan.key, created: true };
  }

  /** POST /admin/packages/deletePlan — حذف؛ اگر سفارشی دارد فقط غیرفعال می‌شود */
  async deletePlan(dto: DeletePlanDto) {
    if (!OID_RE.test(dto.id)) throw AppError.notFound('بسته یافت نشد.');
    const plan = await this.prisma.plan.findUnique({ where: { id: dto.id } });
    if (!plan) throw AppError.notFound('بسته یافت نشد.');
    const orders = await this.prisma.packageOrder.count({ where: { planKey: plan.key } });
    if (orders > 0) {
      // تاریخچه سفارش‌ها به planKey ارجاع دارد → حذف نرم
      await this.prisma.plan.update({ where: { id: plan.id }, data: { isActive: false } });
      return { id: plan.id, deactivated: true, orders };
    }
    await this.prisma.plan.delete({ where: { id: plan.id } });
    return { id: plan.id, deactivated: false, orders: 0 };
  }

  // ─── مدیریت کمپین‌ها (CRUD + درصد جاری) ──────────────────────────────────

  /** POST /admin/packages/getCampaigns — همه کمپین‌ها + وضعیت/آمار جاری */
  async getCampaigns(dto: GetCampaignsDto) {
    const where = { ...(dto.status ? { isActive: dto.status === 'active' } : {}) };
    const campaigns = await this.prisma.salesCampaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return {
      items: campaigns.map((c) => {
        const expired = c.endsAt != null && c.endsAt <= now;
        const running = c.isActive && c.startsAt <= now && !expired;
        const tiers = readTiers(c.tiers);
        return {
          id: c.id,
          title: c.title,
          description: c.description,
          type: c.type === 'quantity' ? 'quantity' : 'time',
          discountPercent: c.discountPercent,
          manualDiscountPercent: c.manualDiscountPercent,
          startsAt: c.startsAt,
          endsAt: c.endsAt,
          isActive: c.isActive,
          expired,
          running,
          /** درصد جاری مؤثر (روی صفحه بسته‌ها همین اعمال می‌شود) */
          currentPercent: running
            ? this.packages.currentPercent(c, c.purchaseCount)
            : 0,
          purchaseCount: c.purchaseCount,
          tiers,
          createdAt: c.createdAt,
        };
      }),
    };
  }

  /** POST /admin/packages/upsertCampaign — ساخت/ویرایش کمپین (id خالی = ساخت) */
  async upsertCampaign(dto: UpsertCampaignDto) {
    const title = dto.title.trim();
    if (title.length < 3) {
      throw AppError.badRequest('عنوان کمپین حداقل ۳ نویسه است.', 'CAMPAIGN_TITLE_INVALID');
    }
    const type = dto.type === 'quantity' ? 'quantity' : 'time';
    const percent = Math.max(0, Math.min(100, Math.round(dto.discountPercent)));
    if (type === 'time' && percent <= 0) {
      throw AppError.badRequest('درصد تخفیف کمپین زمانی باید بزرگ‌تر از صفر باشد.', 'CAMPAIGN_PERCENT_INVALID');
    }

    // اعتبارسنجی پله‌ها (فقط تعدادی) — از مجاور و صعودی
    let tiers: CampaignTier[] = [];
    if (type === 'quantity') {
      tiers = readTiers(dto.tiers ?? []);
      if (tiers.length === 0) {
        throw AppError.badRequest(
          'کمپین تعدادی حداقل یک پله لازم دارد (مثلاً «۱۰ نفر اول ۷۰٪»).',
          'CAMPAIGN_TIERS_INVALID',
        );
      }
      let prevTo = 0;
      for (const t of tiers) {
        if (t.from !== prevTo + 1) {
          throw AppError.badRequest(
            'پله‌ها باید پیوسته باشند — هر پله از «تعداد قبلی + ۱» شروع شود.',
            'CAMPAIGN_TIERS_INVALID',
          );
        }
        prevTo = t.to ?? Number.MAX_SAFE_INTEGER;
      }
    }

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    if (Number.isNaN(startsAt.getTime())) {
      throw AppError.badRequest('تاریخ شروع نامعتبر است.', 'CAMPAIGN_DATE_INVALID');
    }
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (endsAt && Number.isNaN(endsAt.getTime())) {
      throw AppError.badRequest('تاریخ پایان نامعتبر است.', 'CAMPAIGN_DATE_INVALID');
    }
    if (endsAt && endsAt <= startsAt) {
      throw AppError.badRequest('تاریخ پایان باید بعد از شروع باشد.', 'CAMPAIGN_DATE_INVALID');
    }
    const manual =
      dto.manualDiscountPercent == null
        ? null
        : Math.max(0, Math.min(100, Math.round(dto.manualDiscountPercent)));

    const data = {
      title,
      description: dto.description?.trim() || null,
      type,
      discountPercent: percent,
      manualDiscountPercent: manual,
      startsAt,
      endsAt,
      isActive: dto.isActive,
      tiers: (type === 'quantity' ? tiers : null) as unknown as Prisma.InputJsonValue,
    };

    if (dto.id) {
      if (!OID_RE.test(dto.id)) throw AppError.notFound('کمپین یافت نشد.');
      const existing = await this.prisma.salesCampaign.findUnique({ where: { id: dto.id } });
      if (!existing) throw AppError.notFound('کمپین یافت نشد.');
      const c = await this.prisma.salesCampaign.update({ where: { id: dto.id }, data });
      return { id: c.id, created: false };
    }
    const c = await this.prisma.salesCampaign.create({ data });
    return { id: c.id, created: true };
  }

  /** POST /admin/packages/deleteCampaign — حذف کمپین (سفارش‌ها snapshot دارند) */
  async deleteCampaign(dto: DeleteCampaignDto) {
    if (!OID_RE.test(dto.id)) throw AppError.notFound('کمپین یافت نشد.');
    const c = await this.prisma.salesCampaign.findUnique({ where: { id: dto.id } });
    if (!c) throw AppError.notFound('کمپین یافت نشد.');
    await this.prisma.salesCampaign.delete({ where: { id: dto.id } });
    return { id: dto.id };
  }

  /**
   * POST /admin/packages/setCampaignDiscount — تغییر سریع درصد جاری (خواسته
   * مالک: «روی چند هست رو خودم توی تنظیمات کمپین جاری تغییر بدم»).
   * manual=null یعنی برگشت به محاسبه خودکار پله‌ای.
   */
  async setCampaignDiscount(dto: SetCampaignDiscountDto) {
    if (!OID_RE.test(dto.id)) throw AppError.notFound('کمپین یافت نشد.');
    const c = await this.prisma.salesCampaign.findUnique({ where: { id: dto.id } });
    if (!c) throw AppError.notFound('کمپین یافت نشد.');
    const updated = await this.prisma.salesCampaign.update({
      where: { id: dto.id },
      data: { manualDiscountPercent: dto.manualDiscountPercent },
    });
    return {
      id: updated.id,
      manualDiscountPercent: updated.manualDiscountPercent,
      currentPercent: this.packages.currentPercent(updated, updated.purchaseCount),
    };
  }
}
