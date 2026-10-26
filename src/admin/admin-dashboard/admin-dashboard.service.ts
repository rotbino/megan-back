import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.module';

/** آمار زنده پنل ادمین — همه شمارنده‌ها با count همزمان (سبک برای ادمین) */
@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /admin/dashboard/getStats — شمارنده‌های کلیدی + صف‌های انتظار */
  async getStats() {
    const [
      users,
      sellers,
      verifiedUsers,
      productsAll,
      productsPending,
      productsConfirmed,
      productsRejected,
      buyRequests,
      chatThreads,
      walletTotal,
      pendingVerifications,
      pendingCharges,
      ladderOrders,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isSeller: true } }),
      this.prisma.user.count({ where: { isVerified: true } }),
      this.prisma.product.count(),
      this.prisma.product.count({ where: { status: 'pending' } }),
      this.prisma.product.count({ where: { status: 'confirmed' } }),
      this.prisma.product.count({ where: { status: 'rejected' } }),
      this.prisma.buyRequest.count(),
      this.prisma.chatThread.count(),
      this.prisma.user.aggregate({ _sum: { walletBalance: true } }),
      this.prisma.verificationOrder.count({ where: { status: 'pending' } }),
      this.prisma.chargeOrder.count({ where: { status: 'pending' } }),
      this.prisma.ladderOrder.count(),
    ]);

    return {
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
        pendingVerifications,
        pendingCharges,
        ladderOrders,
      },
    };
  }
}
