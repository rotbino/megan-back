import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import { env, isDev, jwtExpiresInSeconds } from '../common/config/env';

const OTP_TTL_MS = 2 * 60 * 1000; // عمر کد: ۲ دقیقه
const OTP_MAX_ATTEMPTS = 5;
const OTP_RATE_LIMIT = 3; // حداکثر ۳ کد در ۱۰ دقیقه برای هر شماره
const OTP_RATE_WINDOW_MS = 10 * 60 * 1000;

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

/** شناسه عمومی پروفایل مثل باسکول (wbrstu2g1) — بدون حروف گیج‌کننده */
const USERNAME_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
function generateUserName(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => USERNAME_ALPHABET[b % USERNAME_ALPHABET.length]).join('');
}

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private reaperTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** پاک‌سازی دوره‌ای کدهای منقضی و رفرش‌توکن‌های باطل (TTL ایندکس در Prisma نیست) */
  onModuleInit(): void {
    const boot = setTimeout(() => void this.reapExpired(), 30_000);
    boot.unref?.();
    this.reaperTimer = setInterval(() => void this.reapExpired(), 10 * 60 * 1000);
    this.reaperTimer.unref?.();
  }
  onModuleDestroy(): void {
    if (this.reaperTimer) clearInterval(this.reaperTimer);
  }

  private async reapExpired(): Promise<void> {
    try {
      const now = new Date();
      await this.prisma.otpCode.deleteMany({ where: { expiresAt: { lt: now } } });
      await this.prisma.refreshToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] },
      });
    } catch {
      /* reaper هرگز نباید کاربر را بیدار کند */
    }
  }

  // ─── OTP ────────────────────────────────────────────────────────────────────

  /** POST /auth/sendOtp — ارسال کد ۵ رقمی؛ rate limit ۳ کد در ۱۰ دقیقه */
  async sendOtp(phone: string): Promise<{ devCode?: string; expiresInSec: number }> {
    // سقف ارسال برای هر شماره
    const since = new Date(Date.now() - OTP_RATE_WINDOW_MS);
    const recent = await this.prisma.otpCode.count({ where: { phone, createdAt: { gt: since } } });
    if (recent >= OTP_RATE_LIMIT) {
      throw AppError.badRequest(
        'به تعداد کد تایید درخواست‌شده زیاد است؛ چند دقیقه بعد تلاش کنید.',
        'OTP_RATE_LIMITED',
      );
    }

    const code = String(randomInt(10000, 99999));
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.prisma.otpCode.create({
      data: { phone, codeHash: sha256(`${phone}:${code}`), expiresAt },
    });

    // TODO (فاز بعدی): اتصال به سرویس پیامک — فعلاً فقط devCode در development
    return { expiresInSec: OTP_TTL_MS / 1000, ...(isDev ? { devCode: code } : {}) };
  }

  /** POST /auth/verifyOtp — تایید کد + ورود/ثبت‌نام خودکار (توکن‌ها را برمی‌گرداند) */
  async verifyOtp(phone: string, code: string): Promise<{
    isNewUser: boolean;
    accessToken: string;
    refreshToken: string;
  }> {
    const latest = await this.prisma.otpCode.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest || latest.expiresAt < new Date()) {
      throw AppError.badRequest('کد تایید منقضی شده است؛ دوباره درخواست کنید.', 'OTP_EXPIRED');
    }
    if (latest.attempts >= OTP_MAX_ATTEMPTS) {
      throw AppError.badRequest('تلاش‌های شما بیش از حد مجاز بود؛ کد جدید بگیرید.', 'OTP_LOCKED');
    }

    if (latest.codeHash !== sha256(`${phone}:${code}`)) {
      await this.prisma.otpCode.update({
        where: { id: latest.id },
        data: { attempts: { increment: 1 } },
      });
      throw AppError.badRequest('کد تایید اشتباه است.', 'OTP_WRONG');
    }

    // کد مصرف شد
    await this.prisma.otpCode.delete({ where: { id: latest.id } }).catch(() => undefined);

    // ورود/ثبت‌نام یکجا — مثل باسکول
    let user = await this.prisma.user.findUnique({ where: { phone } });
    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      user = await this.prisma.user.create({
        data: {
          phone,
          userName: await this.uniqueUserName(),
        },
      });
    }

    const accessToken = await this.signAccessToken(user.id, user.phone, user.role);
    const refreshToken = await this.issueRefreshToken(user.id);

    return { isNewUser, accessToken, refreshToken };
  }

  /** POST /auth/refreshToken — چرخشی: توکن جدید صادر و قبلی باطل می‌شود */
  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = sha256(refreshToken);
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!row || row.revokedAt || row.expiresAt < new Date()) {
      throw AppError.unauthorized('نشست شما منقضی شده است؛ دوباره وارد شوید.');
    }

    // باطل‌سازی توکن فعلی + صدور جفت جدید (چرخشی)
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user) throw AppError.unauthorized('حساب کاربری یافت نشد.');

    return {
      accessToken: await this.signAccessToken(user.id, user.phone, user.role),
      refreshToken: await this.issueRefreshToken(user.id),
    };
  }

  /** POST /auth/logout — ابطال رفرش‌توکن */
  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { tokenHash: sha256(refreshToken) },
      data: { revokedAt: new Date() },
    }).catch(() => undefined); // خروج با توکن نامعتبر هم موفق است
  }

  // ─── داخلی ──────────────────────────────────────────────────────────────────

  private async signAccessToken(userId: string, phone: string, role: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, phone, role },
      { expiresIn: jwtExpiresInSeconds() },
    );
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await this.prisma.refreshToken.create({ data: { tokenHash: sha256(token), userId, expiresAt } });
    return token;
  }

  private async uniqueUserName(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const candidate = generateUserName();
      const exists = await this.prisma.user.findUnique({ where: { userName: candidate } });
      if (!exists) return candidate;
    }
    return `${generateUserName()}${Date.now().toString(36)}`;
  }
}
