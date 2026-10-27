import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.module';
import { USER_SELECT, toUserCard, UserCard } from '../user-card';
import type { GetCallReportDto } from './dto';

export interface AdminCallRow {
  id: string;
  caller: UserCard;
  callee: UserCard;
  product: { id: number; name: string } | null;
  source: string;
  createdAt: Date;
}

export interface AdminCallStats {
  total: number;
  today: number;
  last7Days: number;
  last30Days: number;
  /** تماس‌گیرندگان یکتا — چند نفر فعال در حال تماس‌اند */
  uniqueCallers: number;
  /** دریافت‌کنندگان یکتا — چند فروشنده در حال تماس دریافت‌اند */
  uniqueCallees: number;
}

/**
 * گزارش تماس‌های کاربران — نمای ادمین (فقط خواندنی).
 *
 * هدف مالک: بداند چه کسی با چه کسی در حال معامله است و حجم تماس‌ها
 * چقدر است (سنجه سلامت بازار lead-gen). داده خام از CallLog — همان
 * لحظه‌ای که خریدار شماره فروشنده را دید ثبت شده است.
 */
@Injectable()
export class AdminCallsService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /admin/calls/getCallReport — لیست تماس‌ها (تازه‌ها بالا) + آمار */
  async getCallReport(dto: GetCallReportDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));
    const s = dto.search?.trim();

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const d7 = new Date(Date.now() - 7 * 86_400_000);
    const d30 = new Date(Date.now() - 30 * 86_400_000);

    const rangeFrom =
      dto.range === 'today'
        ? startOfDay
        : dto.range === 'd7'
          ? d7
          : dto.range === 'd30'
            ? d30
            : null;

    const baseWhere = {
      ...(rangeFrom ? { createdAt: { gte: rangeFrom } } : {}),
      ...(s
        ? {
            OR: [
              {
                caller: {
                  OR: [
                    { phone: { contains: s } },
                    { userName: { contains: s } },
                    { firstName: { contains: s } },
                    { lastName: { contains: s } },
                  ],
                },
              },
              {
                callee: {
                  OR: [
                    { phone: { contains: s } },
                    { userName: { contains: s } },
                    { firstName: { contains: s } },
                    { lastName: { contains: s } },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const include = {
      caller: { select: USER_SELECT },
      callee: { select: USER_SELECT },
      product: { select: { id: true, productName: true } },
    };

    const [total, rows, statsTotal, today, last7, last30, callersAgg, calleesAgg] =
      await Promise.all([
        this.prisma.callLog.count({ where: baseWhere }),
        this.prisma.callLog.findMany({
          where: baseWhere,
          include,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * perPage,
          take: perPage,
        }),
        // آمار همیشه کل را نشان می‌دهد — فیلتر صفحه روی شمارنده‌ها اثر ندارد
        this.prisma.callLog.count(),
        this.prisma.callLog.count({ where: { createdAt: { gte: startOfDay } } }),
        this.prisma.callLog.count({ where: { createdAt: { gte: d7 } } }),
        this.prisma.callLog.count({ where: { createdAt: { gte: d30 } } }),
        this.prisma.callLog.groupBy({ by: ['callerId'], _count: { callerId: true } }),
        this.prisma.callLog.groupBy({ by: ['calleeId'], _count: { calleeId: true } }),
      ]);

    const items: AdminCallRow[] = rows.map((c) => ({
      id: c.id,
      caller: toUserCard(c.caller),
      callee: toUserCard(c.callee),
      product: c.product ? { id: c.product.id, name: c.product.productName } : null,
      source: c.source,
      createdAt: c.createdAt,
    }));

    const stats: AdminCallStats = {
      total: statsTotal,
      today,
      last7Days: last7,
      last30Days: last30,
      uniqueCallers: callersAgg.length,
      uniqueCallees: calleesAgg.length,
    };

    return { total, page, perPage, items, stats };
  }

  /** POST /admin/calls/getCallStats — آمار خالص برای داشبورد */
  async getCallStats() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [total, today, last7Days] = await Promise.all([
      this.prisma.callLog.count(),
      this.prisma.callLog.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.callLog.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
    ]);
    return { total, today, last7Days };
  }
}
