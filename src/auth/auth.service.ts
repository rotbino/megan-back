import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';
import { hashPassword, verifyPassword } from '../common/password';
import { env, isDev, jwtExpiresInSeconds, OTP_FIXED_CODE } from '../common/config/env';
import { forceUserDeparture } from '../chat/io-holder';

const OTP_TTL_MS = 2 * 60 * 1000; // عمر کد: ۲ دقیقه
const OTP_MAX_ATTEMPTS = 5;
const OTP_RATE_LIMIT = 3; // حداکثر ۳ کد در ۱۰ دقیقه برای هر شماره
const OTP_RATE_WINDOW_MS = 10 * 60 * 1000;

// قفل موقت ورود رمزدار — ۵ رمز اشتباه در ۱۵ دقیقه → ۱۵ دقیقه قفل شماره
const LOGIN_FAIL_LIMIT = 5;
const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

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
  /** شمارنده رمز اشتباه هر شماره (درون‌حافظه — با Redis در مقیاس بعدی) */
  private loginFails = new Map<string, { count: number; firstAt: number; lockedUntil?: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cache: CacheService,
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

  // ─── ورود سشن (بدون پیامک) ──────────────────────────────────────────────

  /** POST /auth/login — ورود/ثبت‌نام فقط با شماره موبایل (روش سشن).
   *
   * تا وقتی کاربر برای پنلش رمز عبور تعیین نکرده باشد، ورود بدون رمز مثل
   * دفعه اول ممکن است؛ پس از تعیین رمز (بنر قرمز پنل) رمز الزامی می‌شود.
   * ساختار OTP (sendOtp/verifyOtp) دست‌نخورده مانده تا با رسیدن پنل پیامک،
   * فقط همین متد از فرانت کنار برود — چیز دیگری عوض نمی‌شود. */
  async loginWithSession(
    phone: string,
    password?: string,
  ): Promise<{
    isNewUser: boolean;
    hasPassword: boolean;
    accessToken: string;
    refreshToken: string;
  }> {
    if (this.loginLocked(phone)) {
      throw AppError.badRequest(
        'تلاش‌های ورود بیش از حد مجاز بود؛ ۱۵ دقیقه دیگر دوباره تلاش کنید.',
        'LOGIN_LOCKED',
      );
    }

    let user = await this.prisma.user.findUnique({ where: { phone } });
    let isNewUser = false;

    if (!user) {
      // ثبت‌نام خودکار — مثل جریان OTP قبلی
      isNewUser = true;
      user = await this.prisma.user.create({
        data: { phone, userName: await this.uniqueUserName(), lastLoginAt: new Date() },
      });
    } else {
      // کاربر غیرفعال (A3) — ورود مسدود؛ داده‌ها حذف نشده‌اند
      if (!user.isActive) {
        throw AppError.forbidden('این حساب توسط پشتیبانی غیرفعال شده است؛ با پشتیبانی ایمچ تماس بگیرید.');
      }
      if (user.passwordHash) {
        if (!password) {
          throw AppError.badRequest(
            'برای این شماره رمز عبور تعیین شده است؛ رمز عبور خود را وارد کنید.',
            'PASSWORD_REQUIRED',
          );
        }
        if (!(await verifyPassword(user.passwordHash, password))) {
          this.registerLoginFail(phone);
          throw AppError.badRequest('رمز عبور اشتباه است.', 'PASSWORD_WRONG');
        }
      }
      await this.prisma.user
        .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
        .catch(() => undefined);
    }

    this.clearLoginFails(phone);

    return {
      isNewUser,
      hasPassword: Boolean(user.passwordHash),
      accessToken: await this.signAccessToken(user.id, user.phone, user.role),
      refreshToken: await this.issueRefreshToken(user.id),
    };
  }

  /** POST /auth/setPassword — تعیین/تغییر رمز پنل (کاربر احرازشده).
   *  اولین تعیین بدون رمز فعلی؛ تغییرهای بعدی نیازمند رمز فعلی.
   *
   *  خواسته مالک (۱-۱۱ دور هشتم) — شماره موبایل هم‌زمان قابل ویرایش است:
   *   • شمارهٔ جدید از قبل «رمزدار» است → خطای دقیق + شمارهٔ پشتیبانی
   *     (مالکیت شماره با اولین رمز ثبت می‌شود؛ ادعای شمارهٔ دیگری پذیرفته نیست)؛
   *   • شمارهٔ جدید متعلق به حساب «بی‌رمز» (آرتیفکت ورود سشن) → آن حساب جذب
   *     می‌شود: همهٔ داده‌هایش به این حساب منتقل و خودش حذف می‌شود؛
   *   • پس از موفقیت همهٔ نشست‌ها باطل می‌شوند تا ورود دوباره با رمز جدید
   *     انجام شود (امنیت: رمز تازه = نشست تازه؛ کلاینت قدیمی هم بی‌خطا خارج می‌شود). */
  async setPassword(
    userId: string,
    password: string,
    currentPassword?: string,
    newPhone?: string,
  ): Promise<{ hasPassword: true; phone: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.notFound('کاربر یافت نشد.');

    if (user.passwordHash) {
      if (!currentPassword || !(await verifyPassword(user.passwordHash, currentPassword))) {
        throw AppError.badRequest('رمز عبور فعلی اشتباه است.', 'PASSWORD_WRONG');
      }
    }

    let phone = user.phone;
    if (newPhone && newPhone !== user.phone) {
      const clash = await this.prisma.user.findUnique({ where: { phone: newPhone } });
      if (clash) {
        if (clash.passwordHash) {
          throw AppError.badRequest(
            'برای این شماره موبایل قبلاً رمز تعیین شده است. اگر این شماره موبایل متعلق به شماست و رمز آن را نمی‌دانید، با شماره پشتیبانی 09196421264 تماس بگیرید.',
            'PHONE_HAS_PASSWORD',
          );
        }
        await this.absorbUser(clash, user);
      }
      phone = newPhone;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { phone, passwordHash: await hashPassword(password) },
    });

    // تعیین/تغییر رمز = ابطال همهٔ نشست‌ها (همان منطق logout سرور)
    const now = new Date();
    await this.prisma.refreshToken
      .updateMany({ where: { userId }, data: { revokedAt: now } })
      .catch(() => undefined);
    await this.prisma.user
      .update({ where: { id: userId }, data: { sessionsRevokedAt: now } })
      .catch(() => undefined);
    this.cache.invalidate(`user:alive:${userId}`);
    forceUserDeparture(userId);

    return { hasPassword: true, phone };
  }

  /** جذب حساب بی‌رمزِ شمارهٔ ویرایش‌شده در حساب فعلی (از setPassword).
   *  «بی‌رمز» یعنی هنوز کسی مالکیتش را با رمز claim نکرده — آرتیفکت ورود
   *  سشن است. همهٔ رابطه‌های مالکیت‌دار به مالک جدید منتقل می‌شوند؛ ردیف‌های
   *  تصادم‌کننده با قید یکتای حساب جدید حذف می‌شوند (معنایش با ردیف موجود
   *  یکی است)؛ کیف پول/پرچم‌ها ادغام و فیلدهای خالی از حساب پرمحتوا پر
   *  می‌شوند؛ در پایان ردیف کاربر قدیمی حذف می‌شود. */
  private async absorbUser(stale: User, keeper: User): Promise<void> {
    const sid = stale.id;
    const kid = keeper.id;
    const p = this.prisma;

    // ۱) رابطه‌های سادهٔ مالکیت — فقط جابه‌جایی مالک (بدون قید یکتا)
    await p.product.updateMany({ where: { userId: sid }, data: { userId: kid } });
    await p.buyRequest.updateMany({ where: { userId: sid }, data: { userId: kid } });
    await p.chargeOrder.updateMany({ where: { userId: sid }, data: { userId: kid } });
    await p.packageOrder.updateMany({ where: { userId: sid }, data: { userId: kid } });
    await p.walletAdjustment.updateMany({ where: { userId: sid }, data: { userId: kid } });
    await p.ladderOrder.updateMany({ where: { userId: sid }, data: { userId: kid } });
    await p.verificationOrder.updateMany({ where: { userId: sid }, data: { userId: kid } });
    await p.adminMessage.updateMany({ where: { userId: sid }, data: { userId: kid } });
    await p.activityLog.updateMany({ where: { userId: sid }, data: { userId: kid } });
    await p.productView.updateMany({ where: { viewerId: sid }, data: { viewerId: kid } });
    await p.file.updateMany({ where: { ownerId: sid }, data: { ownerId: kid } });
    await p.supplyOffer.updateMany({ where: { sellerId: sid }, data: { sellerId: kid } });
    await p.supplyOffer.updateMany({ where: { buyerId: sid }, data: { buyerId: kid } });
    await p.callLog.updateMany({ where: { callerId: sid }, data: { callerId: kid } });
    await p.callLog.updateMany({ where: { calleeId: sid }, data: { calleeId: kid } });

    // ۲) علاقه‌مندی کالا — قید یکتای (userId, productId): تکراری حذف
    {
      const rows = await p.favoriteProduct.findMany({
        where: { userId: sid },
        select: { id: true, productId: true },
      });
      if (rows.length) {
        const keeperKeys = new Set(
          (
            await p.favoriteProduct.findMany({
              where: { userId: kid },
              select: { productId: true },
            })
          ).map((r) => r.productId),
        );
        const dupIds = rows.filter((r) => keeperKeys.has(r.productId)).map((r) => r.id);
        if (dupIds.length) await p.favoriteProduct.deleteMany({ where: { id: { in: dupIds } } });
        await p.favoriteProduct.updateMany({ where: { userId: sid }, data: { userId: kid } });
      }
    }

    // ۳) علاقه‌مندی فروشنده — دو سمت: مالک (userId) و هدف (sellerId)
    {
      const owned = await p.favoriteSeller.findMany({
        where: { userId: sid },
        select: { id: true, sellerId: true },
      });
      for (const r of owned) {
        const dup = await p.favoriteSeller.findUnique({
          where: { userId_sellerId: { userId: kid, sellerId: r.sellerId } },
        });
        if (dup) await p.favoriteSeller.delete({ where: { id: r.id } }).catch(() => undefined);
        else
          await p.favoriteSeller
            .update({ where: { id: r.id }, data: { userId: kid } })
            .catch(() => undefined);
      }
      const received = await p.favoriteSeller.findMany({
        where: { sellerId: sid },
        select: { id: true, userId: true },
      });
      for (const r of received) {
        if (r.userId === kid) continue; // خودِ مالک جدید — بی‌معنا
        const dup = await p.favoriteSeller.findUnique({
          where: { userId_sellerId: { userId: r.userId, sellerId: kid } },
        });
        if (dup) await p.favoriteSeller.delete({ where: { id: r.id } }).catch(() => undefined);
        else
          await p.favoriteSeller
            .update({ where: { id: r.id }, data: { sellerId: kid } })
            .catch(() => undefined);
      }
    }

    // ۴) دسته‌های دفتر خرید — قید یکتای (userId, categoryId)
    {
      const rows = await p.buyerCategory.findMany({
        where: { userId: sid },
        select: { id: true, categoryId: true },
      });
      for (const r of rows) {
        const dup = await p.buyerCategory.findUnique({
          where: { userId_categoryId: { userId: kid, categoryId: r.categoryId } },
        });
        if (dup) await p.buyerCategory.delete({ where: { id: r.id } }).catch(() => undefined);
        else
          await p.buyerCategory
            .update({ where: { id: r.id }, data: { userId: kid } })
            .catch(() => undefined);
      }
    }

    // ۵) پرونده‌های پیگیری — نام تکراری با پسوند شماره یکتا می‌شود
    {
      const staleLists = await p.followFolder.findMany({ where: { userId: sid } });
      if (staleLists.length) {
        const keeperNames = new Set(
          (await p.followFolder.findMany({ where: { userId: kid }, select: { name: true } })).map(
            (l) => l.name,
          ),
        );
        for (const l of staleLists) {
          if (!keeperNames.has(l.name)) continue;
          let i = 2;
          let name = `${l.name} (${i})`;
          while (keeperNames.has(name)) name = `${l.name} (${++i})`;
          await p.followFolder.update({ where: { id: l.id }, data: { name } });
          keeperNames.add(name);
        }
        await p.followFolder.updateMany({ where: { userId: sid }, data: { userId: kid } });
        // موارد پیگیری denorm مالک خودشان را دارند — همراه پرونده‌ها منتقل شوند
        await p.followItem.updateMany({ where: { userId: sid }, data: { userId: kid } });
      }
    }
    // (بازنشانی نشانِ کاربران دیگر حذف شد — هدف پیگیری دیگر کاربر نیست؛ آگهی/درخواست است)


    // ۶) نظرات فروشنده — دو سمت (نویسنده/فروشنده) + ممنوعیت خودفروشی
    {
      const written = await p.sellerReview.findMany({
        where: { authorId: sid },
        select: { id: true, sellerId: true },
      });
      for (const r of written) {
        if (r.sellerId === kid) {
          await p.sellerReview.delete({ where: { id: r.id } }).catch(() => undefined);
          continue;
        }
        const dup = await p.sellerReview.findUnique({
          where: { authorId_sellerId: { authorId: kid, sellerId: r.sellerId } },
        });
        if (dup) await p.sellerReview.delete({ where: { id: r.id } }).catch(() => undefined);
        else
          await p.sellerReview
            .update({ where: { id: r.id }, data: { authorId: kid } })
            .catch(() => undefined);
      }
      const received = await p.sellerReview.findMany({
        where: { sellerId: sid },
        select: { id: true, authorId: true },
      });
      for (const r of received) {
        if (r.authorId === kid) {
          await p.sellerReview.delete({ where: { id: r.id } }).catch(() => undefined);
          continue;
        }
        const dup = await p.sellerReview.findUnique({
          where: { authorId_sellerId: { authorId: r.authorId, sellerId: kid } },
        });
        if (dup) await p.sellerReview.delete({ where: { id: r.id } }).catch(() => undefined);
        else
          await p.sellerReview
            .update({ where: { id: r.id }, data: { sellerId: kid } })
            .catch(() => undefined);
      }
    }

    // ۷) گفتگوها — کاربر قدیمی در هر سمت؛ تصادم کلید یکتا = حذف تکراری
    {
      const threads = await p.chatThread.findMany({
        where: { OR: [{ sellerId: sid }, { buyerId: sid }] },
        select: { id: true, sellerId: true, buyerId: true, productId: true },
      });
      for (const t of threads) {
        const sellerId = t.sellerId === sid ? kid : t.sellerId;
        const buyerId = t.buyerId === sid ? kid : t.buyerId;
        if (sellerId === buyerId) {
          // گفتگوی میان همان دو حسابِ در حال ادغام — بی‌معنا شده
          await p.chatThread.delete({ where: { id: t.id } }).catch(() => undefined);
          continue;
        }
        const dup = await p.chatThread.findFirst({
          where: { id: { not: t.id }, sellerId, buyerId, productId: t.productId },
        });
        if (dup) await p.chatThread.delete({ where: { id: t.id } }).catch(() => undefined);
        else
          await p.chatThread
            .update({ where: { id: t.id }, data: { sellerId, buyerId } })
            .catch(() => undefined);
      }
    }

    // ۸) نظرسنجی — هر کاربر یک پاسخ: پاسخ حساب فعلی برتر است
    {
      const staleSurvey = await p.surveyResponse.findUnique({ where: { userId: sid } });
      if (staleSurvey) {
        const keeperSurvey = await p.surveyResponse.findUnique({ where: { userId: kid } });
        if (keeperSurvey)
          await p.surveyResponse.delete({ where: { id: staleSurvey.id } }).catch(() => undefined);
        else
          await p.surveyResponse
            .update({ where: { id: staleSurvey.id }, data: { userId: kid } })
            .catch(() => undefined);
      }
    }

    // ۹) ادغام پرچم‌ها/کیف پول/بسته — فیلدهای خالی از حساب جذب‌شده پر می‌شوند
    const betterPackage =
      (stale.packageExpiresAt?.getTime() ?? 0) > (keeper.packageExpiresAt?.getTime() ?? 0);
    await p.user.update({
      where: { id: kid },
      data: {
        walletBalance: { increment: stale.walletBalance },
        isSeller: keeper.isSeller || stale.isSeller,
        isBuyer: keeper.isBuyer || stale.isBuyer,
        isVerified: keeper.isVerified || stale.isVerified,
        activePakageType: Math.max(keeper.activePakageType, stale.activePakageType),
        ...(betterPackage
          ? { packageExpiresAt: stale.packageExpiresAt, packageStartedAt: stale.packageStartedAt }
          : {}),
        firstName: keeper.firstName || stale.firstName,
        lastName: keeper.lastName || stale.lastName,
        sex: keeper.sex ?? stale.sex,
        avatarUrl: keeper.avatarUrl ?? stale.avatarUrl,
        businessDesc: keeper.businessDesc ?? stale.businessDesc,
        provinceId: keeper.provinceId ?? stale.provinceId,
        cityId: keeper.cityId ?? stale.cityId,
        ...(keeper.profile !== null
          ? { profile: keeper.profile as Prisma.InputJsonValue }
          : stale.profile !== null
            ? { profile: stale.profile as Prisma.InputJsonValue }
            : {}),
      },
    });

    // ۱۰) حذف ردیف کاربر قدیمی — نشست‌ها/پوش‌ها کاسکید می‌شوند؛
    //     بقیهٔ رابطه‌ها در بالا منتقل شده‌اند
    await p.user.delete({ where: { id: sid } });
  }

  // ─── OTP (پنل پیامک — ساختار برای آینده) ──────────────────────────────────

  /** POST /auth/sendOtp — ارسال کد ۴ رقمی؛ rate limit ۳ کد در ۱۰ دقیقه.
   *  OTP_FIXED_CODE (env) غیرخالی باشد همان کد صادر می‌شود (فعلاً 1234 —
   *  تا خرید پنل پیامک؛ بعداً خالی شود تا کد تصادفی واقعی برود).
   *  تا آن زمان فرانت از /auth/login (روش سشن) استفاده می‌کند. */
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

    const code = OTP_FIXED_CODE || String(randomInt(1000, 10000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.prisma.otpCode.create({
      data: { phone, codeHash: sha256(`${phone}:${code}`), expiresAt },
    });

    // TODO (پنل پیامک): OTP_FIXED_CODE از .env خالی شود → کد تصادفی ۴ رقمی + ارسال پیامک.
    // فعلاً کد ثابت 1234 صادر می‌شود و در development همان کد در پاسخ هم برمی‌گردد (devCode).
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
          lastLoginAt: new Date(),
        },
      });
    } else {
      if (!user.isActive) {
        throw AppError.forbidden('این حساب توسط پشتیبانی غیرفعال شده است؛ با پشتیبانی ایمچ تماس بگیرید.');
      }
      await this.prisma.user
        .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
        .catch(() => undefined);
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
    // غیرفعال‌شدن کاربر (A3) — نشست‌های باز هم باید بمیرند
    if (!user.isActive) {
      throw AppError.unauthorized('حساب کاربری غیرفعال است.');
    }

    return {
      accessToken: await this.signAccessToken(user.id, user.phone, user.role),
      refreshToken: await this.issueRefreshToken(user.id),
    };
  }

  /** POST /auth/logout — خروج واقعی، سمت سرور:
   *  ۱) مهر sessions_revoked_at روی کاربر → هر اکسس‌توکنی که قبل از این لحظه
   *     صادر شده (حتی اگر امضایش تا ۷ روز معتبر باشد) فوراً باطل می‌شود.
   *  ۲) همه رفرش‌توکن‌های باز کاربر باطل می‌شوند.
   *  ۳) کش «زنده بودن نشست» ابطال می‌شود تا اثر آن فوری باشد.
   * کاربر از توکن معتبر یا رفرش‌توکن معتبر شناسایی می‌شود؛ هیچ‌کدام نبود
   * (مثلاً کلاینت از قبل پاک شده) → خروج بی‌اثر و موفق (idempotent). */
  async logout(userId?: string, refreshToken?: string): Promise<void> {
    let uid = userId;
    if (!uid && refreshToken) {
      const row = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: sha256(refreshToken) },
      });
      if (row && !row.revokedAt && row.expiresAt > new Date()) uid = row.userId;
    }

    if (uid) {
      const now = new Date();
      await this.prisma.user
        .update({ where: { id: uid }, data: { sessionsRevokedAt: now } })
        .catch(() => undefined);
      // نکته MongoDB: فیلتر revokedAt: null با فیلدهای غایب match نمی‌شود —
      // همه توکن‌های کاربر بدون قید وضعیت باطل می‌شوند (timestamp تازه بی‌ضرر است)
      await this.prisma.refreshToken.updateMany({
        where: { userId: uid },
        data: { revokedAt: now },
      });
      this.cache.invalidate(`user:alive:${uid}`);
      // حضور: خروج = آفلاین همان لحظه — سوکت‌ها قطع + مهر offline_at
      forceUserDeparture(uid);
    }
  }

  // ─── داخلی ──────────────────────────────────────────────────────────────────

  private loginLocked(phone: string): boolean {
    const fail = this.loginFails.get(phone);
    return Boolean(fail?.lockedUntil && fail.lockedUntil > Date.now());
  }

  private registerLoginFail(phone: string): void {
    const now = Date.now();
    const fail = this.loginFails.get(phone) ?? { count: 0, firstAt: now };
    if (now - fail.firstAt > LOGIN_FAIL_WINDOW_MS) {
      fail.count = 0;
      fail.firstAt = now;
    }
    fail.count += 1;
    if (fail.count >= LOGIN_FAIL_LIMIT) fail.lockedUntil = now + LOGIN_LOCK_MS;
    this.loginFails.set(phone, fail);
  }

  private clearLoginFails(phone: string): void {
    this.loginFails.delete(phone);
  }

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
