import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.module';
import { SERVICE_IDS } from '../../service-signups/dto';

export interface SignupAdminRow {
  id: string;
  serviceId: string;
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
    last7Days: number;
  };
}

/**
 * ─── ثبت‌نام سرویس‌های تخصصی (پنل ادمین) ──────────────────────────────────
 * خروجی فرم /services: چه کسانی (صنف + نام کسب‌وکار) برای ریتو/همخرید
 * ثبت‌نام کرده‌اند. آمار تفکیکی هر سرویس سیگنال «کدام سرویس را اول راه‌اندازی
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

    const [total, byService, last7Days, rows] = await Promise.all([
      this.prisma.serviceSignup.count({ where }),
      this.prisma.serviceSignup.groupBy({ by: ['serviceId'], _count: { _all: true }, where: {} }),
      this.prisma.serviceSignup.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      }),
      this.prisma.serviceSignup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          user: { select: { id: true, userName: true, firstName: true, lastName: true, phone: true, avatarUrl: true } },
        },
      }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        serviceId: r.serviceId,
        guild: r.guild,
        businessName: r.businessName,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        user: r.user,
      })),
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
        last7Days,
      },
    };
  }
}
