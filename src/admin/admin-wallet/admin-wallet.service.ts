import { Injectable } from '@nestjs/common';
import { WalletService } from '../../wallet/wallet.service';
import { GetAdminChargeOrdersDto, ReviewAdminChargeOrderDto } from './dto';

/**
 * فاز A5 — مدیریت شارژهای کارت‌به‌کارت (admin/wallet/*).
 *
 * جایگزین مسیرهای قدیمی wallet/getChargeOrders|reviewChargeOrder (توکن
 * کاربر + AdminGuard) — منبع واحد حالا admin/* با AdminJwtAuthGuard است.
 * منطق دامنه (صف، اعمال شارژ اتمیک، دلایل رد) عیناً از WalletService
 * مصرف می‌شود — کپی نمی‌شود (اصل طلایی §۱).
 */
@Injectable()
export class AdminWalletService {
  constructor(private readonly wallet: WalletService) {}

  /** POST /admin/wallet/getChargeOrders — صف فیش‌ها با فیلتر وضعیت */
  async getChargeOrders(dto: GetAdminChargeOrdersDto) {
    return this.wallet.getChargeOrders({
      status: dto.status,
      page: dto.page,
      perPage: dto.perPage,
    });
  }

  /**
   * POST /admin/wallet/reviewChargeOrder — تأیید → شارژ کیف پول؛ رد → دلیل.
   * reviewedBy = شناسه ادمین (نه کاربر عادی) — سابقه دقیق می‌ماند.
   * WalletService فقط admin.id را استفاده می‌کند (reviewedBy)؛ username را
   * به‌عنوان phone ساختگی می‌گذاریم تا شکل AuthUser کامل بماند.
   */
  async reviewChargeOrder(adminId: string, adminUsername: string, dto: ReviewAdminChargeOrderDto) {
    return this.wallet.reviewChargeOrder(
      { id: adminId, phone: adminUsername, role: 'ADMIN' },
      { orderId: dto.orderId, approve: dto.approve, rejectionReason: dto.rejectionReason },
    );
  }
}
