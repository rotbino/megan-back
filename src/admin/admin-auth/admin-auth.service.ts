import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
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
   *
   * رمز اولیه (رفع باگ ۴ — امنیت):
   * • ADMIN_DEFAULT_PASSWORD در env ست شده → همان.
   * • ست نشده → رمز تصادفی قوی تولید می‌شود، فقط هش آن در DB ذخیره می‌شود
   *   و رمز خام یک‌بار در لاگ بوت چاپ می‌شود تا اپراتور بردارد/عوض کند.
   * هیچ رمز پیش‌فرضی در کد وجود ندارد؛ DB منبع حقیقت است.
   */
  async onModuleInit(): Promise<void> {
    try {
      const username = adminEnv.DEFAULT_USERNAME.trim();
      if (!username) {
        this.logger.log('admin-bootstrap: ADMIN_DEFAULT_USERNAME ست نشده — بدون بوت‌استرپ ادامه می‌دهیم');
        return;
      }
      const existing = await this.prisma.adminUser.findUnique({ where: { username } });
      if (existing) return;

      const initialPassword = adminEnv.DEFAULT_PASSWORD || randomBytes(12).toString('base64url');
      await this.prisma.adminUser.create({
        data: {
          username,
          passwordHash: await hashPassword(initialPassword),
          name: 'مدیر ارشد',
          role: 'SUPER_ADMIN',
        },
      });
      if (adminEnv.DEFAULT_PASSWORD) {
        this.logger.warn(`admin-bootstrap: ادمین پیش‌فرض «${username}» از env ساخته شد — پس از اولین ورود رمز را عوض کنید`);
      } else {
        // رمز تصادفی — فقط این‌بار نمایش داده می‌شود؛ ذخیره فقط هش است
        this.logger.warn(
          `admin-bootstrap: ادمین «${username}» با رمز تصادفی ساخته شد. رمز اولیه (فقط همین‌بار): ${initialPassword}`,
        );
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
