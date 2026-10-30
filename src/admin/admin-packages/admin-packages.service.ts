import { Injectable } from '@nestjs/common';
import { PackagesService } from '../../packages/packages.service';
import { GetAdminPackageOrdersDto, ReviewAdminPackageOrderDto } from './dto';

/**
 * مدیریت سفارش‌های بسته اشتراک (admin/packages/*) — عین الگوی A5 شارژها.
 * منطق دامنه (صف، اعمال/تمدید اتمیک بسته، دلایل رد) از PackagesService
 * مصرف می‌شود — کپی نمی‌شود.
 */
@Injectable()
export class AdminPackagesService {
  constructor(private readonly packages: PackagesService) {}

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
}
