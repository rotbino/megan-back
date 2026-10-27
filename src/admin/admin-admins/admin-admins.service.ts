import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.module';
import { AppError } from '../../common/errors/app-error';
import { hashPassword } from '../../common/password';
import {
  CreateAdminDto,
  GetAdminListDto,
  ResetAdminPasswordDto,
  SetAdminActiveDto,
} from './dto';

/** خروجی عمومی ادمین — بدون passwordHash */
export interface AdminRow {
  id: string;
  username: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  actionCount: number;
}

/**
 * فاز A5 — مدیریت ادمین‌ها (فقط SUPER_ADMIN).
 *
 *  • createAdmin — نام کاربری یکتا + رمز scrypt
 *  • setAdminActive — غیرفعال = قفل فوری (گارد توکن وضعیت زنده را از DB
 *    می‌خواند)؛ گارد خودکار-غیرفعال‌سازی و آخرین SUPER_ADMIN
 *  • resetAdminPassword — رمز جدید؛ نشست‌های جاری ۱۲ ساعته stateless اند
 *    (تا انقضا معتبر می‌مانند — قابل قبول برای پنل داخلی)
 */
@Injectable()
export class AdminAdminsService {
  private readonly logger = new Logger(AdminAdminsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** POST /admin/admins/getAdminList — با شمارش عملیات هر ادمین (join گروهی) */
  async getAdminList(dto: GetAdminListDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));

    const [total, rows, counts] = await Promise.all([
      this.prisma.adminUser.count(),
      this.prisma.adminUser.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true, username: true, name: true, role: true,
          isActive: true, lastLoginAt: true, createdAt: true,
        },
      }),
      this.prisma.adminAction.groupBy({ by: ['adminId'], _count: { _all: true } }),
    ]);

    const countMap = new Map(counts.map((c) => [c.adminId, c._count._all]));
    return {
      total,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      items: rows.map((r): AdminRow => ({ ...r, actionCount: countMap.get(r.id) ?? 0 })),
    };
  }

  /** POST /admin/admins/createAdmin — نام کاربری یکتا + نقش + رمز (scrypt) */
  async createAdmin(dto: CreateAdminDto) {
    const username = dto.username.trim();
    const existing = await this.prisma.adminUser.findUnique({ where: { username } });
    if (existing) {
      throw AppError.conflict('این نام کاربری قبلاً ثبت شده است.', 'ADMIN_USERNAME_TAKEN');
    }

    const admin = await this.prisma.adminUser.create({
      data: {
        username,
        name: dto.name.trim(),
        role: dto.role,
        passwordHash: await hashPassword(dto.password),
      },
      select: { id: true, username: true, name: true, role: true, isActive: true, createdAt: true },
    });
    this.logger.log(`admin-created: ${username} (${dto.role})`);
    return admin;
  }

  /** POST /admin/admins/setAdminActive — قفل/بازکردن حساب ادمین */
  async setAdminActive(actorId: string, dto: SetAdminActiveDto) {
    if (dto.adminId === actorId) {
      throw AppError.badRequest('حساب خودتان را نمی‌توانید غیرفعال کنید.', 'ADMIN_SELF_DEACTIVATE');
    }

    const target = await this.prisma.adminUser.findUnique({ where: { id: dto.adminId } });
    if (!target) throw AppError.notFound('ادمین یافت نشد.');

    // آخرین SUPER_ADMIN فعال نباید خاموش شود — قفل مدیریتی سیستم
    if (!dto.active && target.role === 'SUPER_ADMIN') {
      const activeSuperAdmins = await this.prisma.adminUser.count({
        where: { role: 'SUPER_ADMIN', isActive: true },
      });
      if (activeSuperAdmins <= 1) {
        throw AppError.conflict(
          'آخرین مدیر ارشد فعال را نمی‌توانید غیرفعال کنید.',
          'LAST_SUPER_ADMIN',
        );
      }
    }

    const updated = await this.prisma.adminUser.update({
      where: { id: dto.adminId },
      data: { isActive: dto.active },
      select: { id: true, username: true, name: true, role: true, isActive: true },
    });
    this.logger.log(`admin-active: ${updated.username} → ${dto.active}`);
    return updated;
  }

  /** POST /admin/admins/resetAdminPassword — رمز جدید (scrypt) */
  async resetAdminPassword(dto: ResetAdminPasswordDto) {
    const target = await this.prisma.adminUser.findUnique({ where: { id: dto.adminId } });
    if (!target) throw AppError.notFound('ادمین یافت نشد.');

    await this.prisma.adminUser.update({
      where: { id: dto.adminId },
      data: { passwordHash: await hashPassword(dto.newPassword) },
    });
    this.logger.log(`admin-password-reset: ${target.username}`);
    return { id: target.id, username: target.username };
  }
}
