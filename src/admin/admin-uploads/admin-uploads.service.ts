import { Injectable } from '@nestjs/common';
import { UploadsService } from '../../uploads/uploads.service';
import { DeleteOrphansAdminDto, UsageAdminDto } from './dto';

/**
 * فاز A5 — نگهداشت فایل از پنل ادمین (admin/uploads/*).
 *
 * جایگزین مسیرهای قدیمی uploads/listOrphans|deleteOrphans|getUsage (توکن
 * کاربر + AdminGuard) — منطق عروسک‌ها/مصرف عیناً از UploadsService (export
 * شده) مصرف می‌شود — کپی نمی‌شود (اصل طلایی §۱).
 */
@Injectable()
export class AdminUploadsService {
  constructor(private readonly files: UploadsService) {}

  /** POST /admin/uploads/listOrphans — فایل‌های staged منقضی + dangling */
  async listOrphans() {
    return this.files.listOrphans();
  }

  /** POST /admin/uploads/deleteOrphans — حذف عروسک‌ها (با ids یا همه) */
  async deleteOrphans(dto: DeleteOrphansAdminDto) {
    return this.files.deleteOrphans(dto.ids);
  }

  /** POST /admin/uploads/getUsage — مصرف ذخیره‌سازی هر کاربر */
  async getUsage(dto: UsageAdminDto) {
    return this.files.usage(dto.limit ?? 50);
  }
}
