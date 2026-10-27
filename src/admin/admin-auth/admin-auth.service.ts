import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.module';
import { AppError } from '../../common/errors/app-error';
import { hashPassword, verifyPassword } from '../../common/password';
import { adminEnv, adminJwtSecret, jwtExpiresInSeconds } from '../../common/config/env';

// قفل ورود ادمین — ۵ رمز غلط در ۱۵ دقیقه → ۱۵ دقیقه قفل نام کاربری
const ADMIN_LOGIN_FAIL_LIMIT = 5;
const ADMIN_LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_LOCK_MS = 15 * 60 * 1000;

/** خروجی عمومی ادمین — بدون هیچ داده حساسی */
export interface AdminPublic {
  id: string;
  username: string;
  name: string;
  role: string;
  lastLoginAt: string | null;
}

@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);
  private loginFails = new Map<string, { count: number; firstAt: number; lockedUntil?: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * بوت‌استرپ ادمین پیش‌فرض — فقط وقتی هیچ ادمینی با آن نام کاربری نیست
   * ساخته می‌شود؛ رمز عوض‌شده هرگز بازنویسی نمی‌شود.
   * نام/رمز از env (ADMIN_DEFAULT_USERNAME/ADMIN_DEFAULT_PASSWORD).
   */
  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.prisma.adminUser.findUnique({
        where: { username: adminEnv.DEFAULT_USERNAME },
      });
      if (!existing) {
        await this.prisma.adminUser.create({
          data: {
            username: adminEnv.DEFAULT_USERNAME,
            passwordHash: await hashPassword(adminEnv.DEFAULT_PASSWORD),
            name: 'مدیر ارشد',
            role: 'SUPER_ADMIN',
          },
        });
        this.logger.warn(`admin-bootstrap: ادمین پیش‌فرض «${adminEnv.DEFAULT_USERNAME}» ساخته شد`);
      }
    } catch (err) {
      // بوت نباید fail-fast باشد — ولی حتماً دیده شود
      this.logger.error('admin-bootstrap: ساخت ادمین پیش‌فرض ناموفق بود', err as Error);
    }
  }

  /** POST /admin/auth/login — نام کاربری + رمز → توکن ادمین (scope=admin) */
  async login(username: string, password: string): Promise<{ token: string; admin: AdminPublic }> {
    const key = username.trim().toLowerCase();
    if (this.loginLocked(key)) {
      throw AppError.badRequest(
        'تلاش‌های ورود بیش از حد مجاز بود؛ ۱۵ دقیقه دیگر تلاش کنید.',
        'ADMIN_LOGIN_LOCKED',
      );
    }

    const admin = await this.prisma.adminUser.findUnique({ where: { username: username.trim() } });
    // پیام یکسان برای کاربر ناموجود/رمز غلط — Enumeration نداشته باش
    if (!admin || !(await verifyPassword(admin.passwordHash, password))) {
      if (admin) this.registerFail(key);
      throw AppError.unauthorized('نام کاربری یا رمز عبور اشتباه است.');
    }
    if (!admin.isActive) {
      throw AppError.forbidden('حساب مدیریت شما غیرفعال است.');
    }

    this.clearFails(key);
    const updated = await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const token = await this.jwt.signAsync(
      { sub: admin.id, username: admin.username, role: admin.role, scope: 'admin' },
      { secret: adminJwtSecret(), expiresIn: jwtExpiresInSeconds(adminEnv.JWT_EXPIRES_IN) },
    );

    this.logger.log(`admin-login: ${admin.username}`);
    return { token, admin: this.toPublic(updated) };
  }

  /** POST /admin/auth/me — ادمین جاری (توکن زنده) */
  async me(adminId: string): Promise<AdminPublic> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) throw AppError.unauthorized('حساب مدیریت یافت نشد.');
    return this.toPublic(admin);
  }

  /** POST /admin/auth/changePassword — با رمز فعلی */
  async changePassword(adminId: string, currentPassword: string, newPassword: string): Promise<void> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) throw AppError.unauthorized('حساب مدیریت یافت نشد.');
    if (!(await verifyPassword(admin.passwordHash, currentPassword))) {
      throw AppError.badRequest('رمز عبور فعلی اشتباه است.', 'ADMIN_PASSWORD_WRONG');
    }
    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    this.logger.log(`admin-change-password: ${adminId}`);
  }

  /** POST /admin/auth/logout — توکن کوتاه‌عمر stateless است؛ عملسمبل برای تقارن API */
  async logout(): Promise<void> {
    /* توکن ۱۲ ساعته stateless — ابطال سمت کلاینت (حذف توکن) کافی است */
  }

  // ─── داخلی ─────────────────────────────────────────────────────────────

  private toPublic(a: { id: string; username: string; name: string; role: string; lastLoginAt: Date | null }): AdminPublic {
    return {
      id: a.id,
      username: a.username,
      name: a.name,
      role: a.role,
      lastLoginAt: a.lastLoginAt ? a.lastLoginAt.toISOString() : null,
    };
  }

  private loginLocked(key: string): boolean {
    const fail = this.loginFails.get(key);
    return Boolean(fail?.lockedUntil && fail.lockedUntil > Date.now());
  }

  private registerFail(key: string): void {
    const now = Date.now();
    const fail = this.loginFails.get(key) ?? { count: 0, firstAt: now };
    if (now - fail.firstAt > ADMIN_LOGIN_FAIL_WINDOW_MS) {
      fail.count = 0;
      fail.firstAt = now;
    }
    fail.count += 1;
    if (fail.count >= ADMIN_LOGIN_FAIL_LIMIT) fail.lockedUntil = now + ADMIN_LOGIN_LOCK_MS;
    this.loginFails.set(key, fail);
  }

  private clearFails(key: string): void {
    this.loginFails.delete(key);
  }
}
