import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.module';
import { SERVICE_IDS } from '../../service-signups/dto';

/** نقش خوانده‌شده — ردیف‌های قدیمیِ بدون نقش، فروشنده حساب می‌شوند */
export type AdminSignupRole = 'buyer' | 'seller' | 'both';

export interface SignupAdminRow {
  id: string;
  serviceId: string;
  role: AdminSignupRole;
  guild: string;
  businessName: string;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    userName: string;
    firstName: string;
    lastName: string;
    phone: string;
    avatarUrl: string | null;
    /** آیدی سفارشی کاتالوگ — null = پیش‌فرض (userName)؛ لینک: /c/{catalogId ?? userName} */
    catalogId: string | null;
  };
}

export interface SignupListPage {
  items: SignupAdminRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  stats: {
    total: number;
    byService: Array<{ serviceId: string; count: number }>;
    /** به تفکیک نقش — buyer+both = کل خریداران، seller+both = کل فروشندگان */
    byRole: { buyer: number; seller: number; both: number };
    last7Days: number;
  };
}

/** نرمال‌سازی نقش ذخیره‌شده — null/ناشناخته → فروشنده (ثبت‌های پیشین) */
function readRole(role: string | null | undefined): AdminSignupRole {
  return role === 'buyer' || role === 'seller' || role === 'both' ? role : 'seller';
}

/**
 * ─── ثبت‌نام سرویس‌های تخصصی (پنل ادمین) ──────────────────────────────────
 * خروجی فرم /services: چه کسانی (نقش + صنف + کسب‌وکار) برای میدان‌یار،
 * خرید از کارخانه، پخشیار و همخرید ثبت‌نام کرده‌اند + لینک کاتالوگ هر
 * کاربر. آمار تفکیکی هر سرویس و هر نقش، سیگنال «کدام طرح را اول اجرا
 * کنیم» است — فقط خواندن؛ دادهٔ علاقه‌مندی حذف نمی‌شود.
 */
@Injectable()
export class AdminServiceSignupsService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /admin/service-signups/getSignupList — فهرست + آمار تفکیکی */
  async getSignupList(dto: { search?: string; serviceId?: string; page?: number; perPage?: number }): Promise<SignupListPage> {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));

    // جستجو: نام کسب‌وکار/صنف ثبت‌نام یا مشخصات ثبت‌نام‌کننده
    const term = dto.search?.trim();
    const where = {
      ...(dto.serviceId ? { serviceId: dto.serviceId } : {}),
      ...(term
        ? {
            OR: [
              { businessName: { contains: term } },
              { guild: { contains: term } },
              {
                user: {
                  OR: [
                    { firstName: { contains: term } },
                    { lastName: { contains: term } },
                    { phone: { contains: term } },
                    { userName: { contains: term } },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const [total, byService, byServiceRole, last7Days, rows] = await Promise.all([
      this.prisma.serviceSignup.count({ where }),
      this.prisma.serviceSignup.groupBy({ by: ['serviceId'], _count: { _all: true }, where: {} }),
      this.prisma.serviceSignup.groupBy({ by: ['role'], _count: { _all: true }, where: {} }),
      this.prisma.serviceSignup.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      }),
      this.prisma.serviceSignup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          user: {
            select: {
              id: true,
              userName: true,
              firstName: true,
              lastName: true,
              phone: true,
              avatarUrl: true,
              catalog: { select: { catalogId: true } },
            },
          },
        },
      }),
    ]);

    const byRole = { buyer: 0, seller: 0, both: 0 };
    for (const g of byServiceRole) {
      const role = readRole(g.role);
      byRole[role] += g._count._all;
    }

    return {
      items: rows.map((r) => {
        // رابطهٔ catalog (شیء خام) در پاسخ نمی‌آید — فقط catalogId نهایی
        const { catalog, ...user } = r.user;
        return {
          id: r.id,
          serviceId: r.serviceId,
          role: readRole(r.role),
          guild: r.guild,
          businessName: r.businessName,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          user: { ...user, catalogId: catalog?.catalogId ?? null },
        };
      }),
      total,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      stats: {
        total,
        byService: SERVICE_IDS.map((s) => ({
          serviceId: s,
          count: byService.find((d) => d.serviceId === s)?._count._all ?? 0,
        })),
        byRole,
        last7Days,
      },
    };
  }
}
