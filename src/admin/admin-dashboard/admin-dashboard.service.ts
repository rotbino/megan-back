import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.module';
import { AdminActionsService } from '../admin-actions/admin-actions.service';
import { AdminChatsService } from '../admin-chats/admin-chats.service';
import { AdminCallsService } from '../admin-calls/admin-calls.service';

/** شماره روز در کلید YYYY-MM-DD (UTC) — برای نمودار روند */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** آرایه ۳۰ روز اخیر (شامل امروز) با صفر پیش‌فرض */
function emptyDays(): Map<string, number> {
  const days = new Map<string, number>();
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    days.set(dayKey(new Date(now.getTime() - i * 86_400_000)), 0);
  }
  return days;
}

@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actions: AdminActionsService,
    private readonly chatsStats: AdminChatsService,
    private readonly callsStats: AdminCallsService,
  ) {}

  /**
   * POST /admin/dashboard/getStats — آمار کامل داشبورد عملیاتی:
   *  • شمارنده‌های کلیدی (همان شکل A1 — سازگار با فرانت فعلی)
   *  • صف‌های انتظار (احراز/بازبینی/شارژ)
   *  • روند ۳۰ روزه: ثبت‌نام/آگهی/درخواست خرید/درآمد
   *  • درآمد نردبان + شارژ (کل)
   */
  async getStats() {
    const since = new Date(Date.now() - 30 * 86_400_000);

    const [
      users,
      sellers,
      verifiedUsers,
      productsAll,
      productsPending,
      productsConfirmed,
      productsRejected,
      buyRequests,
      buyRequestsPending,
      chatThreads,
      walletTotal,
      pendingVerifications,
      pendingCharges,
      ladderOrders,
      // روند ۳۰ روزه — فقط createdAt (حجم سبک؛ ادمین)
      newUsers,
      newProducts,
      newBuyRequests,
      approvedCharges,
      newLadderOrders,
      // درآمد کل
      ladderRevenueAgg,
      chargeRevenueAgg,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isSeller: true } }),
      this.prisma.user.count({ where: { isVerified: true } }),
      this.prisma.product.count(),
      this.prisma.product.count({ where: { status: 'pending' } }),
      this.prisma.product.count({ where: { status: 'confirmed' } }),
      this.prisma.product.count({ where: { status: 'rejected' } }),
      this.prisma.buyRequest.count(),
      this.prisma.buyRequest.count({ where: { status: 'pending' } }),
      this.prisma.chatThread.count(),
      this.prisma.user.aggregate({ _sum: { walletBalance: true } }),
      this.prisma.verificationOrder.count({ where: { status: 'pending' } }),
      this.prisma.chargeOrder.count({ where: { status: 'pending' } }),
      this.prisma.ladderOrder.count(),
      this.prisma.user.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.prisma.product.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.prisma.buyRequest.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.prisma.chargeOrder.findMany({
        where: { createdAt: { gte: since }, status: 'approved' },
        select: { charge: true, createdAt: true },
      }),
      this.prisma.ladderOrder.findMany({
        where: { createdAt: { gte: since } },
        select: { amount: true, createdAt: true },
      }),
      this.prisma.ladderOrder.aggregate({ _sum: { amount: true } }),
      this.prisma.chargeOrder.aggregate({ where: { status: 'approved' }, _sum: { charge: true } }),
    ]);

    // ─── روند ۳۰ روزه — گروه‌بندی روزانه در حافظه ───────────────────
    const regDays = emptyDays();
    for (const r of newUsers) regDays.set(dayKey(r.createdAt), (regDays.get(dayKey(r.createdAt)) ?? 0) + 1);

    const prodDays = emptyDays();
    for (const r of newProducts) prodDays.set(dayKey(r.createdAt), (prodDays.get(dayKey(r.createdAt)) ?? 0) + 1);

    const reqDays = emptyDays();
    for (const r of newBuyRequests) reqDays.set(dayKey(r.createdAt), (reqDays.get(dayKey(r.createdAt)) ?? 0) + 1);

    const chargeDays = emptyDays();
    for (const r of approvedCharges) chargeDays.set(dayKey(r.createdAt), (chargeDays.get(dayKey(r.createdAt)) ?? 0) + r.charge);

    const ladderDays = emptyDays();
    for (const r of newLadderOrders) ladderDays.set(dayKey(r.createdAt), (ladderDays.get(dayKey(r.createdAt)) ?? 0) + r.amount);

    const revenue = [...regDays.keys()].map((date) => ({
      date,
      registrations: regDays.get(date) ?? 0,
      products: prodDays.get(date) ?? 0,
      buyRequests: reqDays.get(date) ?? 0,
      ladderRevenue: ladderDays.get(date) ?? 0,
      chargeRevenue: chargeDays.get(date) ?? 0,
    }));

    return {
      // شمارنده‌های کلیدی — همان شکل A1 (سازگار با فرانت فعلی)
      users: {
        total: users,
        sellers,
        verified: verifiedUsers,
      },
      products: {
        total: productsAll,
        pending: productsPending,
        confirmed: productsConfirmed,
        rejected: productsRejected,
      },
      buyRequests,
      chatThreads,
      wallet: {
        totalBalance: walletTotal._sum.walletBalance ?? 0, // تومان — کل گردش کیف‌ها
      },
      queues: {
        pendingProducts: productsPending,
        pendingBuyRequests: buyRequestsPending,
        pendingVerifications,
        pendingCharges,
        ladderOrders,
      },
      // درآمد (تومان) — نردبان پرداختی + شارژ تأییدشده (هدیه ادمین amount=0 است)
      revenue: {
        ladderTotal: ladderRevenueAgg._sum.amount ?? 0,
        chargeTotal: chargeRevenueAgg._sum.charge ?? 0,
        last30Days: {
          ladder: newLadderOrders.reduce((s, r) => s + r.amount, 0),
          charge: approvedCharges.reduce((s, r) => s + r.charge, 0),
        },
      },
      // روند ۳۰ روزه — برای نمودار داشبورد
      trends: revenue,
      // چت‌ها و تماس‌ها (A6) — سنجه‌های روزانه ادمین:
      // پیام خوانده‌نشده برای فروشنده‌ای آمده؟ (awaitingSellerReply)
      // چند تماس امروز ثبت شده؟ (calls.today)
      chats: await this.chatsStats.getChatStats(),
      calls: await this.callsStats.getCallStats(),
    };
  }

  /**
   * POST /admin/dashboard/getRecentActivity — آخرین عملیات ادمین‌ها +
   * آخرین ثبت‌نام‌ها (فید زنده داشبورد).
   */
  async getRecentActivity() {
    const [recentActions, recentUsers] = await Promise.all([
      this.actions.getRecentActions(12),
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true, phone: true, userName: true, firstName: true,
          lastName: true, isSeller: true, createdAt: true,
        },
      }),
    ]);
    return { recentActions, recentUsers };
  }
}
