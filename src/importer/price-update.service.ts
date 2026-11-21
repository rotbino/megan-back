/**
 * آپدیت قیمت‌ها + شناسایی کاربران جدید باسکول (۲۱-۱۱، خواستهٔ مالک — «یک تیر
 * برای دو نشان»؛ نوسازی ۲۲-۱۱: کاربران جدید «در دیتابیس» ثبت می‌شوند).
 *
 * هر فراخوانی «اسکن» یک تکهٔ ۱۰۰۰تایی از لیست عمومی جدیدترین آگهی‌های باسکول
 * را می‌گیرد و از همان دو کار را می‌کند:
 *   ۱) آپدیت قیمت/موجودی/حداقل‌سفارش آگهی‌های موجود در ایمچ — id عددی آگهی
 *      ایمپورت‌شده همان id باسکول است؛ فقط ردیف‌های «واقعاً متفاوت» آپدیت
 *      می‌شوند (یک select سبک + مقایسه در حافظه + یک دستور update خام —
 *      نه select/save تک‌تکی؛ خواستهٔ مالک: منابع کم، سرعت بالا).
 *   ۲) شناسایی کاربران تازه‌ثبت‌نام باسکول که هنوز در ایمچ نیستند —
 *      user_info هر آیتم یونیک می‌شود، با bUserName جدول یوزر تطبیق داده
 *      می‌شود و غایب‌ها «همان‌جا در جدول PendingImportUser ثبت می‌شوند»
 *      (خواستهٔ مالک ۲۲-۱۱: یک بار که پیدا شدیم دیگر توی دیتابیس داریمش —
 *      «کاربران در انتظار ایمپورت»؛ بدون موبایل). لیست صفحه از همان جدول
 *      خوانده می‌شود و بین جلسه‌ها/ریفرش‌ها می‌ماند؛ با ایمپورت کامل، رکورد
 *      حذف و کاربر از لیست خارج می‌شود.
 *
 * ادب شبکه (خواستهٔ مالک — «باسکول تشخیص ندهد ماشین هست و بلاکمون نکند»):
 *   • لیست جدیدترین‌ها «بدون کوکی» گرفته می‌شود — با کوکی، باسکول نتیجه را با
 *     فعالیت/جستجوی صاحب کوکی هماهنگ می‌کند و آخرین آگهی‌های واقعی نمی‌آید.
 *   • بین دو اسکنِ متوالی حداقل ۵ ثانیه فاصله — فرانت شمارش معکوس را نشان
 *     می‌دهد؛ همین گارد سمت سرور هم هست تا دابل‌کلیک/دو تب نتواند فاصله را
 *     بشکند (وضعیت ماژول-سطح؛ در سرورلس روی نمونهٔ گرم همان پروسه).
 *
 * شمارهٔ موبایل فروشنده (/get_seller_phone_number): کوکی می‌خواهد و باسکول به
 * هر کوکی فقط ۲۰ شماره می‌دهد (خواستهٔ مالک) — بودجهٔ مصرفی ماژول-سطح، با
 * عوض‌شدن کوکی صفر می‌شود؛ پاسخِ {phone} یا {data:{phone}} هر دو پذیرفته است.
 * دکمهٔ «گرفتن موبایل» شماره را روی رکورد PendingImportUser ذخیره می‌کند
 * (خواستهٔ مالک ۲۲-۱۱) تا دکمهٔ ایمپورت بعدی بدون مصرف دوبارهٔ سهمیه، مستقیم
 * سراغ ایمپورت کامل برود.
 *
 * سرورلس‌پسند: هیچ جاب/حلقهٔ بلندی اینجا اجرا نمی‌شود — هر فراخوانی فقط یک
 * تکهٔ کوچک کار می‌کند (≪ تایم‌اوت ۶۰ث ورسل) و فرانت حلقهٔ بچ‌ها را
 * می‌چرخاند؛ تکرار هر تکه idempotent است (مقایسه، بعد آپدیت).
 *
 * ⚠️ اعداد در دستور update خام با {$numberInt} می‌روند تا ستون‌های Int
 * (stock/min_sale_price/min_sale_amount) Int32 بمانند — عدد لختِ EJSON
 * «double» می‌شود و Prisma هنگام خواندن Int همان Int32 را انتظار دارد.
 */

import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { BuskoolClient, buskoolConfig, type BkLatestItem, type BkLatestListResp, type BkSellerPhoneResp } from './buskool.client';
import { importerAdminPhone } from './dto';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** فاصلهٔ اجباری بین شروع دو اسکن (گرفتن لیست) — خواستهٔ مالک ۲۱-۱۱ */
const SCAN_MIN_GAP_MS = 5_000;
/** سقف کاربران برگشتی هر اسکن — لیست در فرانت بین بچ‌ها یونیک می‌شود */
const NEW_USERS_CAP = 300;
/** سقف آگهی‌های قابل آپدیت در یک اسکن (هر بچ ۱۰۰۰تایی) */
const BATCH_MAX = 1_000;

/** تاریخ باسکول «YYYY-MM-DD HH:mm:ss» → Date؛ نامعتبر → null */
function bkDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.trim().replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** عدد امن از پاسخ باسکول (ممکن است رشته/غیرواقعی باشد) */
function toCount(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Int32 صریح برای دستور خام — عدد لخت در EJSON double می‌شود */
const int32 = (n: number) => ({ $numberInt: String(Math.floor(n)) });

/** نرمال‌سازی شمارهٔ موبایل باسکول → ۰۹xxxxxxxxx؛ ناقص → null */
function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  // ارقام فارسی/عربی → لاتین
  let s = String(raw)
    .replace(/[\u06F0-\u06F9\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) & 0xf))
    .replace(/[\s\-()]/g, '');
  if (/^0098/.test(s)) s = `0${s.slice(4)}`;
  else if (/^98(9\d{9})$/.test(s)) s = `0${s.slice(2)}`;
  else if (/^9\d{9}$/.test(s)) s = `0${s}`;
  return /^0\d{10}$/.test(s) ? s : null;
}

/** کاربر باسکولِ دیده‌شده در یک اسکن — غایب در ایمچ و تازه‌ثبت‌نام */
export interface ScanNewUser {
  bUserId: number;
  bUserName: string;
  firstName: string;
  lastName: string;
  /** تاریخ ثبت‌نام در باسکول (ISO) */
  createdAt: string | null;
  isVerified: boolean;
  activePakageType: number;
  /** نمونه‌آگهی برای گرفتن شماره (s_id/p_id) و نمایش */
  sampleProductId: number;
  sampleProductName: string;
  sampleCategory: string | null;
  samplePrice: number;
  /** چند آگهی از او در این بچ دیده شد */
  adsSeen: number;
}

/** رکورد «کاربر در انتظار ایمپورت» — ردیف جدول صفحهٔ آپدیت (۲۲-۱۱) */
export interface PendingImportUserRow {
  bUserId: number;
  bUserName: string;
  firstName: string;
  lastName: string;
  createdAt: string | null;
  isVerified: boolean;
  activePakageType: number;
  /** شمارهٔ موبایل — null یعنی هنوز گرفته نشده (بدون موبایل ثبت شده) */
  phone: string | null;
  phoneTakenAt: string | null;
  sampleProductId: number;
  sampleProductName: string;
  sampleCategory: string | null;
  samplePrice: number;
  adsSeen: number;
  /** آخرین باری که در اسکن دیده شد (ISO) */
  lastSeenAt: string;
  /** تاریخ ثبت رکورد در دیتابیس (ISO) */
  registeredAt: string;
}

export interface ScanResult {
  from: number;
  to: number;
  /** آیتم‌های خام پاسخ باسکول */
  fetched: number;
  /** بعد از حذف رد/حذف‌شده‌های باسکول */
  kept: number;
  /** آگهی‌هایی که در ایمچ پیدا شدند */
  inImach: number;
  /** قیمت/موجودی/حداقل‌سفارششان فرق داشت و آپدیت شد */
  updated: number;
  /** در ایمچ بودند ولی هیچ تغییری نداشتند */
  unchanged: number;
  /** در ایمچ نبودند (آگهی جدید باسکول) */
  notInImach: number;
  /** کاربران یونیک دیده‌شده در این بچ */
  usersSeen: number;
  /** کاربران غایب در ایمچ (قبل از فیلتر روز) */
  usersMissing: number;
  /** کاربران تازه‌ثبت‌نامِ غایب — همان‌ها در دیتابیس هم ثبت شدند */
  newUsers: ScanNewUser[];
  /** به سقف NEW_USERS_CAP خورد */
  truncated: boolean;
  /** مهر اجرای این تکه */
  at: string;
}

export interface PhoneBudgetInfo {
  limit: number;
  used: number;
  remaining: number;
}

@Injectable()
export class PriceUpdateService {
  private readonly logger = new Logger(PriceUpdateService.name);

  /** گارد ۵ ثانیه بین اسکن‌ها — آخرین باری که «لیست» از باسکول گرفته شد */
  private lastScanAt = 0;

  /** بودجهٔ شماره‌های موبایل هر کوکی — با عوض‌شدن BUSKOOL_COOKIE صفر می‌شود */
  private phoneUse: { cookie: string; used: number } = { cookie: '', used: 0 };

  constructor(private readonly prisma: PrismaService) {}

  private assertAdmin(adminPhone: string) {
    if (adminPhone !== importerAdminPhone()) {
      throw new ForbiddenException('آپدیت قیمت‌ها فقط برای حساب ادمین در دسترس است');
    }
  }

  private budgetInfo(): PhoneBudgetInfo {
    const { cookie } = buskoolConfig();
    if (this.phoneUse.cookie !== cookie) this.phoneUse = { cookie, used: 0 };
    const limit = Math.max(1, toCount(process.env.BUSKOOL_PHONE_BUDGET, 20));
    return { limit, used: this.phoneUse.used, remaining: Math.max(0, limit - this.phoneUse.used) };
  }

  // ═══════════════════════════ اسکن: آپدیت + شناسایی ═══════════════════════════

  /**
   * یک تکه از لیست جدیدترین آگهی‌های باسکول (بدون کوکی، sort_by=RD):
   * قیمت آگهی‌های موجود را تازه می‌کند و کاربران غایبِ تازه‌ثبت‌نام را
   * برمی‌گرداند. idempotent — اجرای دوبارهٔ همان بازه فقط تغییرات تازه را می‌گیرد.
   */
  async scan(
    adminPhone: string,
    input: { from: number; to: number; updatePrices?: boolean; recentDays?: number },
  ): Promise<ScanResult> {
    this.assertAdmin(adminPhone);
    // بازهٔ [from, to) نیمه‌باز و ۰-بنیاد — بچ اول: 0→1000 (تست زندهٔ ۲۱-۱۱)
    const from = Math.max(0, Math.floor(input.from ?? 0));
    const to = Math.min(Math.max(from + 1, Math.floor(input.to ?? from + BATCH_MAX)), from + BATCH_MAX);
    const updatePrices = input.updatePrices !== false;
    const recentDays = Math.max(0, Math.floor(input.recentDays ?? 10));

    // ── گارد ۵ ثانیه — حتی با دابل‌کلیک/دو تب، فاصلهٔ لیست‌ها شکسته نمی‌شود ──
    const wait = this.lastScanAt + SCAN_MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastScanAt = Date.now();

    const bk = new BuskoolClient(() => false);
    const resp: BkLatestListResp = await bk.call(
      '/user/get_product_list',
      {
        from_record_number: from,
        to_record_number: to,
        sort_by: 'RD',
        response_rate: false,
        client: 'web',
      },
      { noCookie: true },
    );
    // مهر بعد از پایان دریافت — فاصله از «پایان» قبلی سنجیده می‌شود (محافظه‌کار)
    this.lastScanAt = Date.now();

    const items = (resp?.products ?? []).filter(
      (p) => p?.main && !p.main.is_rejected && !p.main.deleted_at,
    );
    const res: ScanResult = {
      from,
      to,
      fetched: resp?.products?.length ?? 0,
      kept: items.length,
      inImach: 0,
      updated: 0,
      unchanged: 0,
      notInImach: 0,
      usersSeen: 0,
      usersMissing: 0,
      newUsers: [],
      truncated: false,
      at: new Date().toISOString(),
    };
    if (!items.length) return res;

    // ── ۱) آپدیت قیمت آگهی‌های موجود ─────────────────────────────────────────
    // فقط همین ۵ فیلد خوانده می‌شود (خواستهٔ مالک: کل رکورد را نکش بیرون) —
    // userId برای سطر سابقهٔ تغییر لازم است، جزئیات ندارد.
    const existing = await this.prisma.product.findMany({
      where: { id: { in: items.map((it) => it.main.id) } },
      select: { id: true, userId: true, stock: true, minSalePrice: true, minSaleAmount: true },
    });
    const byId = new Map(existing.map((p) => [p.id, p]));
    res.inImach = existing.length;
    res.notInImach = items.length - existing.length;

    if (updatePrices) {
      const nowIso = new Date().toISOString();
      const updates: {
        id: number;
        stock: number;
        price: number;
        amount: number;
        /** مهر قیمت: آخرین به‌روزرسانی خود باسکول (last_price_update || updated_at) */
        priceAt: string;
        userId: string;
        before: { stock: number; minSalePrice: number; minSaleAmount: number };
      }[] = [];
      for (const it of items) {
        const cur = byId.get(it.main.id);
        if (!cur) continue;
        const stock = toCount(it.main.stock, cur.stock);
        const price = toCount(it.main.min_sale_price, cur.minSalePrice);
        const amount = toCount(it.main.min_sale_amount, cur.minSaleAmount);
        if (stock === cur.stock && price === cur.minSalePrice && amount === cur.minSaleAmount) continue;
        updates.push({
          id: it.main.id,
          stock,
          price,
          amount,
          // همان ادبِ web-import: مهر قیمت از خود باسکول، نه «الان»
          priceAt: (bkDate(it.main.last_price_update) ?? bkDate(it.main.updated_at) ?? new Date()).toISOString(),
          userId: cur.userId,
          before: { stock: cur.stock, minSalePrice: cur.minSalePrice, minSaleAmount: cur.minSaleAmount },
        });
      }

      if (updates.length) {
        // یک دستور update خام با statements — یک رفت‌وبرگشت به Atlas (الگوی
        // fix-identity ۲۰-۱۱؛ آپدیت‌های تکی از ورسل ۱۲تایی/ثانیه بود)
        const statements = updates.map((u) => ({
          q: { _id: u.id },
          u: {
            $set: {
              stock: int32(u.stock),
              min_sale_price: int32(u.price),
              min_sale_amount: int32(u.amount),
              price_updated_at: { $date: u.priceAt },
              updated_at: { $date: nowIso },
            },
          },
        }));
        const upRes = (await this.prisma.$runCommandRaw({
          update: 'Product',
          updates: statements as unknown as Prisma.InputJsonObject[],
          ordered: false,
        })) as unknown as { nModified?: number; n?: number; modifiedCount?: number; writeErrors?: unknown[] };
        res.updated = Number(upRes?.nModified ?? upRes?.modifiedCount ?? upRes?.n ?? updates.length);
        if (upRes?.writeErrors?.length) {
          this.logger.warn(`price-sync: ${upRes.writeErrors.length} statement failed`);
        }
        res.unchanged = Math.max(0, res.inImach - updates.length);

        // سابقهٔ تغییر (رجوع در اختلاف‌ها — همان الگوی web-import) —
        // best-effort با createMany؛ خطایش هرگز آپدیت قیمت را خراب نمی‌کند
        try {
          await this.prisma.productEditHistory.createMany({
            data: updates.map((u) => ({
              productId: u.id,
              userId: u.userId,
              action: 'price-sync',
              before: u.before,
              after: { stock: u.stock, minSalePrice: u.price, minSaleAmount: u.amount },
              createdAt: new Date(),
            })),
          });
        } catch (err) {
          this.logger.warn(`price-sync history failed: ${(err as Error).message}`);
        }
      } else {
        res.unchanged = res.inImach;
      }
    } else {
      res.unchanged = res.inImach;
    }

    // ── ۲) شناسایی کاربران غایبِ تازه‌ثبت‌نام ─────────────────────────────────
    const seen = new Map<number, { user: BkLatestItem['user_info']; adsSeen: number; sample: BkLatestItem['main'] }>();
    for (const it of items) {
      const u = it.user_info;
      if (!u?.id || !u.user_name) continue;
      const prev = seen.get(u.id);
      if (prev) prev.adsSeen++;
      else seen.set(u.id, { user: u, adsSeen: 1, sample: it.main });
    }
    res.usersSeen = seen.size;
    if (!seen.size) return res;

    // تطبیق با ایمچ — کلید bUserName (قاعدهٔ هویت ۲۰-۱۱؛ یوزرنیم آیمچ مستقل است)
    const names = [...seen.values()].map((s) => s.user.user_name);
    const found = await this.prisma.user.findMany({
      where: { bUserName: { in: names } },
      select: { bUserName: true },
    });
    const inImach = new Set(found.map((f) => f.bUserName as string));

    const sinceMs = recentDays > 0 ? Date.now() - recentDays * 86_400_000 : 0;
    const missingAll: ScanNewUser[] = [];
    for (const s of seen.values()) {
      if (inImach.has(s.user.user_name)) continue;
      const createdAt = bkDate(s.user.created_at);
      // فیلتر روز فقط وقتی خواسته شده (۰ = همهٔ غایب‌ها) — پیش‌فرض ۱۰ روز
      if (sinceMs && (!createdAt || createdAt.getTime() < sinceMs)) continue;
      missingAll.push({
        bUserId: s.user.id,
        bUserName: s.user.user_name,
        firstName: (s.user.first_name ?? '').trim(),
        lastName: (s.user.last_name ?? '').trim(),
        createdAt: createdAt?.toISOString() ?? null,
        isVerified: s.user.is_verified === 1,
        activePakageType: toCount(s.user.active_pakage_type),
        sampleProductId: s.sample.id,
        sampleProductName: (s.sample.product_name ?? '').trim(),
        sampleCategory: (s.sample.sub_category_name ?? s.sample.category_name ?? '').trim() || null,
        samplePrice: toCount(s.sample.min_sale_price),
        adsSeen: s.adsSeen,
      });
    }
    res.usersMissing = missingAll.length;
    // مرتب: تازه‌ثبت‌نام‌تر اول — بعد سقف (فرانت بین بچ‌ها یونیک می‌کند)
    missingAll.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    if (missingAll.length > NEW_USERS_CAP) {
      res.newUsers = missingAll.slice(0, NEW_USERS_CAP);
      res.truncated = true;
    } else {
      res.newUsers = missingAll;
    }

    // ── ثبت در دیتابیس: «کاربران در انتظار ایمپورت» (خواستهٔ مالک ۲۲-۱۱) ──
    // یک بار که پیدا شد، دیگر داریمش — رکورد بدون موبایل ساخته می‌شود و
    // لیست صفحه از دیتابیس خوانده می‌شود (ماندگار بین جلسه‌ها). به‌روزرسانی
    // رکورد موجود: فقط داده‌های اسکن (نمونه‌آگهی/تعداد/نام) — موبایلِ گرفته‌شده
    // و مهرش هرگز بازنویسی نمی‌شوند. best-effort: خطای دیتابیس اسکن را
    // نمی‌اندازد (قیمت‌ها همین الان آپدیت شده‌اند؛ رکوردها در اسکن بعدی/دوباره
    // می‌آیند).
    if (missingAll.length) {
      try {
        await this.upsertPending(missingAll);
      } catch (err) {
        this.logger.warn(`pending-upsert failed: ${(err as Error).message}`);
      }
    }
    return res;
  }

  /** ثبت/به‌روزرسانی رکوردهای «در انتظار ایمپورت» — کلید یکتا bUserId.
   *  موبایل گرفته‌شده و مهرش در رکورد موجود حفظ می‌شوند.
   *  موازی قطعه‌ای (۲۰تایی) — با recentDays=0 یک بچ می‌تواند صدها کاربر غایب
   *  داشته باشد و upsertهای پیاپیِ تکی روی Atlas از ورسل کُند می‌شوند. */
  private async upsertPending(users: ScanNewUser[]) {
    const now = new Date();
    const CONCURRENCY = 20;
    for (let i = 0; i < users.length; i += CONCURRENCY) {
      const chunk = users.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map((u) =>
          this.prisma.pendingImportUser.upsert({
            where: { bUserId: u.bUserId },
            create: {
              bUserId: u.bUserId,
              bUserName: u.bUserName,
              firstName: u.firstName,
              lastName: u.lastName,
              bCreatedAt: u.createdAt ? new Date(u.createdAt) : null,
              isVerified: u.isVerified,
              activePakageType: u.activePakageType,
              sampleProductId: u.sampleProductId,
              sampleProductName: u.sampleProductName,
              sampleCategory: u.sampleCategory,
              samplePrice: u.samplePrice,
              adsSeen: u.adsSeen,
              lastSeenAt: now,
            },
            update: {
              bUserName: u.bUserName,
              firstName: u.firstName,
              lastName: u.lastName,
              bCreatedAt: u.createdAt ? new Date(u.createdAt) : undefined,
              isVerified: u.isVerified,
              activePakageType: u.activePakageType,
              sampleProductId: u.sampleProductId,
              sampleProductName: u.sampleProductName,
              sampleCategory: u.sampleCategory,
              samplePrice: u.samplePrice,
              adsSeen: u.adsSeen,
              lastSeenAt: now,
            },
          }),
        ),
      );
    }
  }

  // ═══════════════════════════ لیست انتظار ایمپورت ═══════════════════════════

  /** سقف لیست برگشتی — لیست صفحه خوانا بماند */
  private static readonly PENDING_LIST_CAP = 500;

  /**
   * لیست «کاربران در انتظار ایمپورت» (خواستهٔ مالک ۲۲-۱۱) — منبع جدول صفحهٔ
   * آپدیت؛ ماندگار بین جلسه‌ها/ریفرش‌ها.
   *
   * خودترمیمی قبل از خواندن: رکوردهایی که کاربرشان الان در ایمچ است (با ایمپورت
   * کامل، از هر مسیری: تک‌کاربره/لیستی/وب/دیمت) حذف می‌شوند — استاب failedImport
   * حذف نمی‌شود چون کاربر هنوز «کامل» ایمپورت نشده و مالک باید بتواند دوباره
   * ایمپورتش کند (موبایلش هم که گرفته شده حفظ شده — سهمیه دوباره مصرف نمی‌شود).
   */
  async pendingUsers(adminPhone: string): Promise<{ users: PendingImportUserRow[]; removedImported: number }> {
    this.assertAdmin(adminPhone);

    // ── خودترمیمی: ایمپورت‌شده‌های کامل را از لیست بگیر ──
    let removedImported = 0;
    const pendings = await this.prisma.pendingImportUser.findMany({
      select: { bUserName: true },
    });
    if (pendings.length) {
      const names = pendings.map((p) => p.bUserName);
      const imported = await this.prisma.user.findMany({
        where: { bUserName: { in: names }, failedImport: false },
        select: { bUserName: true },
      });
      if (imported.length) {
        const del = await this.prisma.pendingImportUser.deleteMany({
          where: { bUserName: { in: imported.map((i) => i.bUserName).filter((n): n is string => !!n) } },
        });
        removedImported = del.count;
      }
    }

    // مرتب: تازه‌ثبت‌نام‌تر اول — در سورت مونگو nullها در desc خودشان آخر می‌افتند
    const rows = await this.prisma.pendingImportUser.findMany({
      orderBy: [{ bCreatedAt: 'desc' }, { createdAt: 'desc' }],
      take: PriceUpdateService.PENDING_LIST_CAP,
    });
    const users: PendingImportUserRow[] = rows.map((r) => ({
      bUserId: r.bUserId,
      bUserName: r.bUserName,
      firstName: r.firstName,
      lastName: r.lastName,
      createdAt: r.bCreatedAt?.toISOString() ?? null,
      isVerified: r.isVerified,
      activePakageType: r.activePakageType,
      phone: r.phone ?? null,
      phoneTakenAt: r.phoneTakenAt?.toISOString() ?? null,
      sampleProductId: r.sampleProductId,
      sampleProductName: r.sampleProductName,
      sampleCategory: r.sampleCategory ?? null,
      samplePrice: r.samplePrice,
      adsSeen: r.adsSeen,
      lastSeenAt: r.lastSeenAt.toISOString(),
      registeredAt: r.createdAt.toISOString(),
    }));
    return { users, removedImported };
  }

  // ═══════════════════════════ شمارهٔ موبایل فروشنده ═══════════════════════════

  /**
   * گرفتن شمارهٔ موبایل یک فروشندهٔ باسکول — کوکی می‌خواهد؛ هر کوکی فقط ۲۰
   * شماره (محدودیت باسکول). پاسخ {phone} یا {data:{phone}} هر دو پذیرفته است.
   *
   * اگر bUserName داده شود (خواستهٔ مالک ۲۲-۱۱ — دکمهٔ «گرفتن موبایل»)، شماره
   * روی رکورد «در انتظار ایمپورت» همان کاربر ذخیره می‌شود تا دفعهٔ بعد ایمپورت
   * بدون مصرف دوبارهٔ سهمیه، مستقیم شروع شود.
   */
  async fetchPhone(
    adminPhone: string,
    input: { sId: number; pId: number; bUserName?: string },
  ): Promise<{ phone: string; budget: PhoneBudgetInfo; saved: boolean }> {
    this.assertAdmin(adminPhone);
    const { cookie } = buskoolConfig();
    if (!cookie) {
      throw new BadRequestException('کوکی باسکول تنظیم نشده است (BUSKOOL_COOKIE) — برای گرفتن شماره لازم است');
    }
    const budget = this.budgetInfo();
    if (budget.remaining <= 0) {
      throw new BadRequestException(
        `سهمیهٔ ${budget.limit} شماره‌ای این کوکی باسکول تمام شده (${budget.used} گرفته شده) — کوکی تازه در BUSKOOL_COOKIE بگذارید`,
      );
    }

    const bk = new BuskoolClient(() => false);
    let resp: BkSellerPhoneResp;
    try {
      resp = await bk.call('/get_seller_phone_number', {
        s_id: Math.floor(input.sId),
        p_id: String(Math.floor(input.pId)),
        item: 'PRODUCT',
        client: 'web',
      });
    } catch (err) {
      // پیام تمیز برای مالک — پیشوند فنی «buskool … failed:» حذف می‌شود؛
      // رایج‌ترین حالت: پاسخ HTML یعنی کوکی لاگین نیست/منقضی شده
      const raw = String((err as Error).message ?? err);
      const msg = raw.replace(/^buskool \S+ failed:\s*/, '');
      throw new BadRequestException(
        msg.includes('HTML')
          ? 'کوکی باسکول لاگین نیست یا منقضی شده — کوکی تازهٔ لاگین‌شده در BUSKOOL_COOKIE بگذارید'
          : `گرفتن شماره از باسکول ناموفق بود: ${msg}`,
      );
    }

    // کد فرانت خود باسکول e.data.phone می‌خواند (chunks/1.js) — {phone}
    // مستقیم هم برای اطمینان پذیرفته است
    const raw =
      (typeof resp?.data === 'object' && resp.data !== null ? resp.data.phone : undefined) ??
      (typeof resp?.data === 'string' ? resp.data : undefined) ??
      resp?.phone;
    const phone = normalizePhone(raw);
    if (!phone) {
      throw new BadRequestException(`شماره‌ای در پاسخ باسکول نبود — پاسخ: ${JSON.stringify(resp).slice(0, 160)}`);
    }

    // مصرف بودجه — فقط شمارهٔ واقعاً بیرون‌آمده
    this.phoneUse.used++;

    // ذخیره روی رکورد «در انتظار ایمپورت» — best-effort؛ شکستش گرفتن شماره
    // را خراب نمی‌کند (فرانت شماره را دارد و با همان ایمپورت را شروع می‌کند)
    let saved = false;
    if (input.bUserName) {
      try {
        const upd = await this.prisma.pendingImportUser.updateMany({
          where: { bUserName: input.bUserName },
          data: { phone, phoneTakenAt: new Date() },
        });
        saved = upd.count > 0;
      } catch (err) {
        this.logger.warn(`pending phone-save failed: ${(err as Error).message}`);
      }
    }
    return { phone, budget: this.budgetInfo(), saved };
  }

  // ═══════════════════════════ استخراج تک‌کاربر ═══════════════════════════

  /**
   * پیش‌ایمپورت یک یوزرنیم باسکول (خواستهٔ مالک ۲۱-۱۱): اول چک دیتابیس با
   * bUserName (هویت باسکولی، نه یوزرنیم آیمچ) — از قبل موجود = بدون هیچ تماس
   * با باسکول «موجود» برمی‌گردد؛ غایب = شماره‌اش از باسکول گرفته می‌شود تا
   * فرانت بلافاصله همان ایمپورت تک‌کاربرهٔ همیشگی را با شمارهٔ واقعی شروع کند.
   */
  async extractUser(
    adminPhone: string,
    input: { userName: string },
  ): Promise<{
    exists: boolean;
    phone?: string;
    budget?: PhoneBudgetInfo;
    imach?: { id: string; userName: string; bVerified: boolean };
    note?: string;
  }> {
    this.assertAdmin(adminPhone);
    const userName = input.userName.trim().replace(/^@/, '');
    if (!userName) throw new BadRequestException('یوزرنیم باسکول را وارد کنید');

    // ۱) از قبل در ایمچ؟ — قبل از هر تماس با باسکول (خواستهٔ مالک)
    const existing = await this.prisma.user.findFirst({
      where: { bUserName: userName },
      select: { id: true, userName: true, bVerified: true },
    });
    if (existing) {
      return {
        exists: true,
        imach: { id: existing.id, userName: existing.userName, bVerified: existing.bVerified },
        note: 'این کاربر از قبل در ایمچ است — شماره‌اش هم گرفته نمی‌شود',
      };
    }

    // ۲) پروفایل باسکول — s_id (= user_info.id) برای گرفتن شماره
    const bk = new BuskoolClient(() => false);
    const profile = await bk.call<{ user_info?: { id: number; user_name?: string } }>('/load_profile_by_user_name', {
      user_name: userName,
    });
    const sId = profile?.user_info?.id;
    if (!sId || !profile?.user_info?.user_name) {
      throw new BadRequestException(`کاربر باسکول @${userName} پیدا نشد`);
    }

    // ۳) نمونه‌آگهی — p_id برای گرفتن شماره
    const list = await bk.call<{ products?: { main: { id: number } }[] }>('/get_product_list_by_user_name', {
      user_name: userName,
      status: 2,
      is_public: true,
      from_record_number: 0,
      to_record_number: 20,
    });
    const pId = list?.products?.find((p) => p?.main?.id)?.main.id;
    if (!pId) {
      throw new BadRequestException(`@${userName} آگهی عمومی ندارد — چیزی برای ایمپورت نیست`);
    }

    // ۴) شمارهٔ موبایل (با کوکی + بودجه) — سپس فرانت startSingle را می‌زند.
    // خطای کوکی/شبکه همان‌جا پیام تمیز می‌شود؛ بودجه فقط شمارهٔ واقعی مصرف می‌کند.
    // bUserName هم پاس می‌شود تا اگر همین کاربر در لیست «در انتظار ایمپورت»
    // هست، شماره‌اش روی رکوردش ذخیره شود (سهمیه دوباره مصرف نشود).
    const { phone, budget } = await this.fetchPhone(adminPhone, { sId, pId, bUserName: userName });
    return { exists: false, phone, budget };
  }
}
