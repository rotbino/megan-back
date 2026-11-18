/**
 * «ثبت گروهی محصول» — ایمپورت از وب کاربر (۱۸-۱۱، خواستهٔ مالک).
 *
 * کاربرِ واجد شرایط (عضو سابقِ منبع، از قبل و بدون اطلاع خودش در سیستم
 * ثبت شده) با یک کلیک همهٔ کالاهایش را «از سطح وب» به پنل خودش می‌آورد:
 *   • کالاهای قبلاً ایمپورت‌شده (توسط ادمین): تصاویر دست نمی‌خورد (زحمت
 *     پاک‌سازی واترمارک حفظ می‌شود) و فقط قیمت/موجودی/حداقل سفارش تازه
 *     می‌شود + برای مالک آشکار می‌شود (ownerHidden → false؛ کلیک دکمه =
 *     اجازه و اطلاع مالک — تا آن زمان در پنل خودش دیده نمی‌شد ولی در سطح
 *     عمومی سایت بود).
 *   • کالای جدیدِ منبع: کامل ثبت می‌شود (عنوان/توضیحات/قیمت/موجودی/تصاویر)
 *     با وضعیت «در انتظار تایید» — تا کاربر تصاویر دارای واترمارک سایر
 *     سایت‌ها را عوض کند و تایید شود.
 *   • پروفایل و کسب‌وکار: فقط جاهای خالی از وب پر می‌شود (داده‌ای که خود
 *     کاربر در آیمچ گذاشته هرگز بازنویسی نمی‌شود)؛ سند b همیشه تازه می‌شود.
 *
 * ⚠️ قاعدهٔ طلایی روبروی کاربر: هیچ‌جا نام منبع (باسکول) نمی‌آید — همهٔ
 * متن‌ها «از وب / از سطح اینترنت» هستند؛ کاربر حس می‌کند ایمچ کل وب را
 * برایش می‌گردد. خطاهای فنی (URL/کد HTTP) هرگز به کاربر نشت نمی‌کنند.
 *
 * معماری گام‌محور (سرورلس‌پسند): هیچ state در حافظه نیست؛ همهٔ وضعیت در
 * سند WebImportSession (Atlas) است و هر POST webImportStep فقط «یک تکهٔ
 * کوچک» کار می‌کند (≤ ~۱۰ ثانیه، دور از تایم‌اوت ۶۰ث ورسل) و درصد
 * پیشرفت از همان سند ساخته می‌شود. فرانت حلقهٔ step را می‌چرخاند و
 * نوار درصد/گزارش زنده نشان می‌دهد.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, WebImportSession } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { UploadsService } from '../uploads/uploads.service';
import { AppError } from '../common/errors/app-error';
import type { AuthUser } from '../common/guards';
import { BuskoolClient, type BkProductDetailResp, type BkProfileResp, type BkStatsResp } from '../importer/buskool.client';
import {
  aimchifyBrandMentions,
  fetchImage,
  isBuskoolAutoDesc,
  normalizeImage,
  runPool,
} from '../importer/importer.service';
import { descToText } from '../importer/desc-text';
import { asBUserData, bkPackageTitle, type BUserData } from '../importer/b-user-data';

// ─── ثابت‌ها ─────────────────────────────────────────────────────────────────

/** اندازهٔ صفحهٔ لیست کالاهای منبع (عین ایمپورتر ادمین) */
const PAGE = 20;
/** سقف تصویر هر کالای جدید (عین ایمپورتر ادمین) */
const MAX_PHOTOS_PER_PRODUCT = 4;
/** سقف تصاویر کسب‌وکار که در فاز گالری گرفته می‌شود */
const MAX_GALLERY_IMAGES = 4;
/** بودجهٔ هر گام — کالای موجود ۱ واحد، کالای جدید (عکس‌دار) ۴ واحد */
const STEP_BUDGET = 8;
/** جلسهٔ بی‌تحرکِ در جریان بعد از این مدت مرده فرض می‌شود (ms) */
const STALE_MS = 10 * 60_000;
/** پس از این تعداد گام ناموفق پیاپی، جلسه fails می‌شود */
const MAX_FAILED_STEPS = 25;
/** سقف خطوط log ذخیره‌شده در سند */
const MAX_LOG_LINES = 30;
/** سقف اقلام ذخیره‌شده در سند (حفاظت حجم سند مونگو) */
const MAX_ITEMS = 600;

const GENERIC_STEP_ERROR = 'گامی از جمع‌آوری ناموفق بود — دوباره تلاش کنید';
const GENERIC_FAIL = 'جمع‌آوری کامل نشد؛ لطفاً کمی بعد دوباره تلاش کنید';

export type WebImportMode = 'full' | 'prices';

/** آیتم فشردهٔ کالا — از لیست منبع؛ همهٔ فیلدهای لازم ثبت/به‌روزرسانی */
interface ImportItem {
  id: number;
  name: string;
  description: string;
  stock: number;
  minSalePrice: number;
  minSaleAmount: number;
  unit: string;
  categoryId: number;
  subCategoryId: number;
  categoryName: string;
  subCategoryName: string;
  provinceId: number;
  cityId: number;
  isElevated: number;
  hasVideo: boolean;
  createdAtIso: string | null;
  updatedAtIso: string | null;
  lastPriceIso: string | null;
}

/** شکل counters داخل سند و پاسخ */
export interface WebImportCounters {
  found: number;
  created: number;
  updated: number;
  unchanged: number;
  reassigned: number;
  skippedDeleted: number;
  skippedNew: number;
  skippedOwner: number;
  imagesDone: number;
  imagesFailed: number;
  profileDone: number;
  itemErrors: number;
}

const EMPTY_COUNTERS: WebImportCounters = {
  found: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  reassigned: 0,
  skippedDeleted: 0,
  skippedNew: 0,
  skippedOwner: 0,
  imagesDone: 0,
  imagesFailed: 0,
  profileDone: 0,
  itemErrors: 0,
};

interface LogLine {
  t: number;
  msg: string;
}

/** پاسخ مشترک start/step — قرارداد فرانت (بدون هیچ نشتی از منبع) */
export interface WebImportProgress {
  status: 'running' | 'done' | 'failed' | 'missing';
  mode: WebImportMode;
  phase: string;
  percent: number;
  processed: number;
  total: number;
  counters: WebImportCounters;
  log: string[];
  retry?: boolean;
  message?: string;
}

// ─── سرویس ───────────────────────────────────────────────────────────────────

@Injectable()
export class WebImportService {
  private readonly logger = new Logger(WebImportService.name);
  /** کش دسته‌ها (id → parentId) — عین ایمپورتر؛ تا ری‌استارت پروسه */
  private catCache: Map<number, { parentId: number | null }> | null = null;
  /** گامِ در حال اجرا برای هر جلسه — سریال‌سازی دوبار‌کلیک/دو تب (هم‌نمونه) */
  private readonly busy = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  // ═══════════════════ وضعیت: آیا دکمه دیده شود؟ ═══════════════════

  /**
   * POST /products/webImportStatus — واجد شرایط بودن کاربر برای «ثبت گروهی».
   *
   * شرایط (خواستهٔ مالک): شمارهٔ موبایلی که در ایمچ ثبت‌نام کرده باید از
   * قبل و بدون اطلاع خودش در سیستم ثبت شده باشد — یعنی یا حسابش خودِ حساب
   * ایمپورت‌شده است (b_user_name دارد) یا شماره‌اش در کالکشن منبع هست.
   * بقیهٔ کاربران دکمه را اصلاً نمی‌بینند.
   */
  async status(user: AuthUser): Promise<{ eligible: boolean }> {
    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { bUserName: true, phone: true },
    });
    if (!me) return { eligible: false };
    if (me.bUserName) return { eligible: true };
    const source = await this.sourceUserNameByPhone(me.phone);
    return { eligible: Boolean(source) };
  }

  /** یوزرنیم منبع از روی شمارهٔ موبایل — جستجو در کالکشن منبع (دامپ) */
  private async sourceUserNameByPhone(phone: string): Promise<string | null> {
    if (!phone) return null;
    try {
      const res = (await this.prisma.$runCommandRaw({
        find: this.sourceTable(),
        filter: { phone },
        limit: 1,
        projection: { userName: 1 },
      })) as { cursor?: { firstBatch?: { userName?: string }[] } };
      return res.cursor?.firstBatch?.[0]?.userName?.trim() || null;
    } catch {
      return null;
    }
  }

  private sourceTable(): string {
    return process.env.IMPORT_SOURCE_TABLE?.trim() || 'user-buskool';
  }

  /** تشخیص یوزرنیم منبع کاربر — مسیر ۱: حساب خودش؛ مسیر ۲: شماره در دامپ */
  private async resolveSourceUserName(user: AuthUser): Promise<string | null> {
    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { bUserName: true, phone: true },
    });
    if (!me) return null;
    if (me.bUserName) return me.bUserName;
    return this.sourceUserNameByPhone(me.phone);
  }

  // ═══════════════════ شروع جلسه ═══════════════════

  /**
   * POST /products/webImportStart — ساخت (یا ادامهٔ) جلسهٔ ایمپورت.
   * تک‌جلسگی: هر کاربر حداکثر یک جلسهٔ running دارد؛ جلسهٔ کهنه (>۱۰ دقیقه
   * بی‌تحرک) مرده اعلام و تازه ساخته می‌شود. جلسهٔ done مانع ایمپورت مجدد
   * نیست (همگام‌سازی دوباره آزاد است — آپدیت قیمت و کالای جدید را می‌آورد).
   */
  async start(user: AuthUser, mode: WebImportMode): Promise<WebImportProgress> {
    const sourceUserName = await this.resolveSourceUserName(user);
    if (!sourceUserName) {
      // ناهماهنگی نادر: وضعیت واجد شرایط بود ولی الان منبع پیدا نشد
      throw AppError.forbidden('این امکان برای حساب شما فعال نیست.');
    }

    const running = await this.prisma.webImportSession.findFirst({
      where: { userId: user.id, status: 'running' },
      orderBy: { createdAt: 'desc' },
    });
    if (running) {
      const stale = Date.now() - running.updatedAt.getTime() > STALE_MS;
      if (!stale) return this.toProgress(running);
      await this.prisma.webImportSession.update({
        where: { id: running.id },
        data: { status: 'failed', error: 'وقفه در جمع‌آوری — لغو شد', finishedAt: new Date() },
      });
    }

    const session = await this.prisma.webImportSession.create({
      data: {
        userId: user.id,
        mode,
        status: 'running',
        sourceUserName,
        phase: 'search',
        counters: EMPTY_COUNTERS as unknown as object,
        log: [line('در حال جستجوی کالاهای شما در سطح وب…')] as unknown as object,
      },
    });
    this.logger.log(`web-import start user=${user.id} mode=${mode}`);
    return this.toProgress(session);
  }

  // ═══════════════════ گام بعدی ═══════════════════

  /**
   * POST /products/webImportStep — پردازش تکهٔ بعدی جلسهٔ کاربر جاری.
   *
   * ماشینی از فازها روی خودِ سند (بدون حافظهٔ پروسه — سازگار با سرورلس):
   *   search → (full: profile → gallery) → products → done
   * هر فراخوانی «به اندازهٔ بودجه» پیش می‌رود؛ خطا هرگز استثنا به کاربر
   * نمی‌دهد — پاسخ retry:true می‌آید تا فرانت ادامه دهد و فقط پس از تکرار
   * زیاد، جلسه failed می‌شود (پیام عمومی، بدون نشت فنی).
   */
  async step(user: AuthUser): Promise<WebImportProgress> {
    let session = await this.prisma.webImportSession.findFirst({
      where: { userId: user.id, status: 'running' },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) return { status: 'missing', mode: 'full', phase: 'none', percent: 0, processed: 0, total: 0, counters: { ...EMPTY_COUNTERS }, log: [] };

    // گام همزمانِ همین جلسه؟ — همین وضعیت را برگردان؛ فرانت دوباره می‌پرسد
    if (this.busy.has(session.id)) return this.toProgress(session);
    this.busy.add(session.id);
    try {
      const changes = await this.runStep(session);
      session = await this.prisma.webImportSession.update({
        where: { id: session.id },
        data: changes,
      });
      return this.toProgress(session);
    } catch (err) {
      // جزئیات فنی فقط در لاگ سرور؛ روبروی کاربر پیام عمومی
      this.logger.warn(`web-import step failed user=${user.id}: ${(err as Error)?.message}`);
      const failedSteps = (session.failedSteps ?? 0) + 1;
      const dead = failedSteps >= MAX_FAILED_STEPS;
      const log = pushLog(readLog(session.log), dead ? GENERIC_FAIL : GENERIC_STEP_ERROR);
      const failed = await this.prisma.webImportSession.update({
        where: { id: session.id },
        data: {
          failedSteps,
          log: log as unknown as object,
          ...(dead ? { status: 'failed' as const, error: GENERIC_FAIL, finishedAt: new Date() } : {}),
        },
      });
      return this.toProgress(failed, !dead);
    } finally {
      this.busy.delete(session.id);
    }
  }

  /** یک گام — کل ماشین فازها؛ خروجی = تغییرات سند برای ذخیرهٔ یکجا */
  private async runStep(session: WebImportSession): Promise<Prisma.WebImportSessionUpdateInput> {
    const counters = { ...EMPTY_COUNTERS, ...readCounters(session.counters) };
    const log = readLog(session.log);
    const mode = session.mode as WebImportMode;
    const items = readItems(session.items);
    const bk = new BuskoolClient(() => false);

    // ── فاز ۱: جستجو — یک صفحهٔ لیست کالاها ──
    if (session.phase === 'search') {
      const from = session.listFrom;
      const resp = await this.callSource<BkProductListRespLike>(bk, '/get_product_list_by_user_name', {
        user_name: session.sourceUserName,
        status: 2,
        is_public: true,
        from_record_number: from,
        to_record_number: from + PAGE,
      });
      const batch = (resp?.products ?? []).filter((p) => p?.main && !p.main.is_rejected && !p.main.deleted_at);
      for (const p of batch) {
        if (items.length >= MAX_ITEMS) break;
        items.push(toItem(p.main));
      }
      const reachedCap = items.length >= MAX_ITEMS;
      const listDone = batch.length < PAGE || reachedCap;
      return {
        items: items as unknown as object,
        listFrom: from + PAGE,
        listDone,
        ...(listDone
          ? {
              total: items.length,
              counters: { ...counters, found: items.length } as unknown as object,
              phase: mode === 'full' ? 'profile' : 'products',
              log: pushLog(
                log,
                items.length
                  ? `${fa(items.length)} کالا برای شما در وب پیدا شد — در حال جمع‌آوری…`
                  : 'جستجو کامل شد؛ کالایی برای شما در وب پیدا نشد',
              ) as unknown as object,
            }
          : {}),
      };
    }

    // ── فاز ۲ (فقط full): پروفایل و کسب‌وکار ──
    if (session.phase === 'profile') {
      const done = await this.syncProfile(session, bk, log);
      return {
        phase: 'gallery',
        counters: { ...counters, profileDone: done ? 1 : 0 } as unknown as object,
        log: pushLog(
          log,
          done
            ? 'اطلاعات پروفایل و کسب‌وکار شما از وب تکمیل شد'
            : 'اطلاعات کسب‌وکار از وب کامل در دسترس نبود — ادامه می‌دهیم',
        ) as unknown as object,
      };
    }

    // ── فاز ۳ (فقط full): تصاویر کسب‌وکار — فقط وقتی گالری خالی است ──
    if (session.phase === 'gallery') {
      await this.syncBusinessGallery(session, counters);
      return {
        phase: 'products',
        counters: counters as unknown as object,
        log: pushLog(log, 'در حال جمع‌آوری کالاها از وب…') as unknown as object,
      };
    }

    // ── فاز ۴: کالاها — تا بودجهٔ گام ──
    if (session.phase === 'products') {
      let cursor = session.cursor;
      let budget = STEP_BUDGET;
      const catById = await this.getCatById();

      while (budget > 0 && cursor < items.length) {
        const it = items[cursor];
        try {
          const existing = await this.prisma.product.findUnique({ where: { id: it.id } });
          if (!existing) {
            if (mode === 'prices') {
              // حالت «فقط به‌روزرسانی» — کالای جدید ثبت نمی‌شود
              counters.skippedNew++;
              budget -= 1;
            } else {
              await this.createItem(session.userId, it, catById);
              const imgs = await this.fetchItemPhotos(bk, session, it, counters);
              budget -= 4;
              counters.created++;
              pushLog(log, `کالای «${it.name}» اضافه شد${imgs ? ' (همراه تصاویر)' : ''}`);
            }
          } else if (existing.status === 'deleted') {
            // کاربر قبلاً خودش حذفش کرده — زنده نمی‌کنیم
            counters.skippedDeleted++;
            budget -= 1;
          } else if (existing.userId === session.userId) {
            const res = await this.updateMine(existing, it, session.userId);
            if (res === 'updated') {
              counters.updated++;
              pushLog(log, `قیمت و موجودی «${it.name}» از وب به‌روز شد`);
            } else if (res === 'shown') {
              counters.updated++;
              pushLog(log, `کالای «${it.name}» به پنل شما اضافه شد`);
            } else counters.unchanged++;
            budget -= 1;
          } else {
            // مالکِ رکورد حساب دیگری است — فقط اگر آن حساب «جامد» (بی‌صاحب)
            // باشد به کاربر جاری منتقل می‌شود؛ حساب فعال دیگری دست نمی‌خورد
            const moved = await this.reassignIfOrphan(existing, it, session.userId);
            if (moved) {
              counters.reassigned++;
              pushLog(log, `کالای «${it.name}» به پنل شما اضافه و به‌روز شد`);
            } else counters.skippedOwner++;
            budget -= 1;
          }
        } catch (err) {
          // سیاست خطای رکورد (عین ایمپورتر ادمین): این کالا رد شد، بقیه ادامه
          this.logger.warn(`web-import item #${it.id} failed: ${(err as Error)?.message}`);
          counters.itemErrors++;
          pushLog(log, `کالای «${it.name}» جمع‌آوری نشد — رد شد`);
          budget -= 1;
        }
        cursor++;
      }

      const finished = cursor >= items.length;
      return {
        cursor,
        counters: counters as unknown as object,
        log: pushLog(log, finished ? finalMessage(counters) : '') as unknown as object,
        ...(finished ? { status: 'done' as const, phase: 'done' as const, finishedAt: new Date() } : {}),
      };
    }

    // فاز ناشناخته (نباید بیفتد) — جلسه را ببند
    return { status: 'failed', error: GENERIC_FAIL, finishedAt: new Date() };
  }

  // ─── تماس با منبع ─────────────────────────────────────────────────────────

  /** تماس با منبع با پیام خطای داخلی (نشت URL/کد HTTP به کاربر ممنوع) */
  private async callSource<T>(bk: BuskoolClient, path: string, body: Record<string, unknown>): Promise<T> {
    try {
      return await bk.call<T>(path, body);
    } catch (err) {
      throw new Error(`source-call-failed: ${(err as Error)?.message ?? err}`);
    }
  }

  // ─── فاز پروفایل: پر کردن جاهای خالی (هرگز بازنویسی دادهٔ کاربر) ─────────

  private async syncProfile(session: WebImportSession, bk: BuskoolClient, log: LogLine[]): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return false;

    const profile = await this.callSource<BkProfileResp>(bk, '/load_profile_by_user_name', {
      user_name: session.sourceUserName,
    }).catch(() => null);
    if (!profile?.user_info?.user_name) return false;
    const ui = profile.user_info;
    const pf = profile.profile;

    const stats = await this.callSource<BkStatsResp>(bk, '/get_user_statistics_by_user_name', {
      user_name: session.sourceUserName,
    }).catch(() => null);
    const st = stats?.statistics?.user_info;

    // سند b — عین ایمپورتر ادمین؛ مهرهای CRM و اولین ایمپورت حفظ می‌شود
    const prevB = asBUserData(user.b);
    const bkPackageType = st?.active_package_type ?? ui.active_pakage_type ?? 0;
    const relatedUrls = (profile.relateds ?? [])
      .map((r) => (typeof r === 'string' ? r.trim() : (r?.name ?? '').trim()))
      .filter(Boolean);
    const descAuto = isBuskoolAutoDesc(pf?.description);
    const bData: BUserData = {
      source: 'buskool',
      userName: session.sourceUserName,
      userId: ui.id,
      profileId: pf?.id ?? null,
      premium: {
        isPremium: bkPackageType > 0,
        packageType: bkPackageType,
        packageTitle: bkPackageTitle(bkPackageType),
      },
      isVerified: ui.is_verified === 1,
      isBuyer: ui.is_buyer === 1,
      isSeller: ui.is_seller === 1,
      isBlocked: (ui.is_blocked ?? 0) === 1,
      walletBalance: ui.wallet_balance ?? 0,
      phoneViewPermission: ui.phone_view_permission ?? null,
      categoryId: ui.category_id ?? null,
      customerStatus: ui.customer_status ?? null,
      supportStatus: ui.support_status ?? null,
      comingFrom: ui.coming_from ?? null,
      activityType: ui.activity_type ?? null,
      activityDomain: profile.activity_domain ?? pf?.activity_domain ?? null,
      sex: ui.sex ?? null,
      province: ui.province ?? null,
      city: ui.city ?? null,
      address: pf?.address ?? null,
      postalCode: (pf?.postal_code ?? '') || null,
      isCompany: pf?.is_company === 1 || Boolean((pf?.company_name ?? '').trim()),
      companyName: (pf?.company_name ?? '').trim(),
      companyRegisterCode: (pf?.company_register_code ?? '') || null,
      confirmed: pf?.confirmed === 1,
      relateds: relatedUrls,
      profilePhotoUrl: (pf?.profile_photo ?? '') || null,
      descriptionRaw: descAuto ? null : (pf?.description ?? '').trim() || null,
      descriptionIsAuto: descAuto,
      responseRate: st?.response_rate ?? null,
      reputationScore: st?.reputation_score ?? null,
      productsCount: st?.products_count ?? null,
      ratingCount: stats?.statistics?.rating_info?.total_count ?? null,
      ratingAvg: stats?.statistics?.rating_info?.avg_rating_score ?? null,
      ibp: profile.ibp === true,
      createdAt: bkDate(ui.created_at)?.toISOString() ?? null,
      importedAt: prevB?.importedAt ?? new Date().toISOString(),
      contactedAt: prevB?.contactedAt ?? null,
    };

    // فقط جاهای خالی — داده‌ای که کاربر خودش گذاشته مقدم است
    const data: Prisma.UserUpdateInput = {
      b: bData as unknown as object,
      bUserName: session.sourceUserName,
    };
    if (!user.firstName && ui.first_name) data.firstName = ui.first_name;
    if (!user.lastName && ui.last_name) data.lastName = ui.last_name;
    if (user.sex == null && ui.sex) data.sex = ui.sex;

    // مکان — فقط اگر کاربر ندارد
    let provinceId = user.provinceId;
    if (provinceId == null && ui.province) {
      const loc = await this.findLocation('province', ui.province);
      if (loc?.buskolId != null) {
        provinceId = loc.buskolId;
        data.provinceId = loc.buskolId;
      }
    }
    if (user.cityId == null && ui.city && provinceId != null) {
      const loc = await this.findLocation('city', ui.city, provinceId);
      if (loc?.buskolId != null) data.cityId = loc.buskolId;
    }

    if (!user.businessDesc && !descAuto && (pf?.description ?? '').trim()) {
      data.businessDesc = aimchifyBrandMentions((pf?.description ?? '').trim());
    }
    if (ui.is_verified === 1 && !user.isVerified) data.isVerified = true;

    // profile embedded — فقط کلیدهای خالی پر می‌شوند
    const prevProfile = (user.profile as Record<string, unknown> | null) ?? {};
    const nextProfile: Record<string, unknown> = { ...prevProfile };
    if (prevProfile.address == null && pf?.address) nextProfile.address = pf.address;
    if (!prevProfile.isCompany && (pf?.is_company === 1 || Boolean((pf?.company_name ?? '').trim())))
      nextProfile.isCompany = true;
    if (!prevProfile.companyName && (pf?.company_name ?? '').trim())
      nextProfile.companyName = (pf?.company_name ?? '').trim();
    if (prevProfile.activityDomain == null && (profile.activity_domain ?? pf?.activity_domain))
      nextProfile.activityDomain = profile.activity_domain ?? pf?.activity_domain;
    data.profile = nextProfile as unknown as object;

    await this.prisma.user.update({ where: { id: user.id }, data });

    // آواتار — فقط اگر کاربر عکسی ندارد
    if (!user.avatarUrl && (pf?.profile_photo ?? '').trim()) {
      const url = (pf?.profile_photo ?? '').trim();
      const img = await fetchImage(url, () => false).catch(() => null);
      const norm = img ? await normalizeImage(img.buf, img.mime).catch(() => null) : null;
      if (norm) {
        const res = await this.uploads
          .ingestExternal({
            ownerId: user.id,
            model: 'User',
            modelId: user.id,
            fieldKey: 'avatar',
            buffer: norm.buf,
            mimetype: norm.mime,
            filename: url.split('/').pop() || 'web-avatar',
            replace: true,
            metadata: { importedFrom: 'web-import', originalUrl: url },
          })
          .catch(() => null);
        if (res?.ok) {
          await this.prisma.user.update({ where: { id: user.id }, data: { avatarUrl: res.file.url } });
          pushLog(log, 'تصویر پروفایل شما از وب تکمیل شد');
        }
      }
    }
    return true;
  }

  /** گالری کسب‌وکار — فقط وقتی کاربر هیچ تصویری ندارد (idempotent با originalUrl) */
  private async syncBusinessGallery(session: WebImportSession, counters: WebImportCounters): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, b: true },
    });
    if (!user) return false;

    const existing = await this.prisma.file.findMany({
      where: { relatedModel: 'User', relatedId: user.id, fieldKey: 'gallery' },
      select: { metadata: true },
    });
    if (existing.length) return false; // گالری چیده‌شدهٔ خود کاربر — دست نمی‌زنیم

    const b = asBUserData(user.b);
    const urls = (b?.relateds ?? []).filter(Boolean).slice(0, MAX_GALLERY_IMAGES);
    if (!urls.length) return false;

    const seen = new Set(
      existing
        .map((f) => (f.metadata as { originalUrl?: string } | null)?.originalUrl)
        .filter((u): u is string => Boolean(u)),
    );
    const todo = urls.map((url, i) => ({ url, i })).filter((t) => !seen.has(t.url));
    if (!todo.length) return false;

    await runPool(todo, 2, () => false, async (t) => {
      const img = await fetchImage(t.url, () => false).catch(() => null);
      const norm = img ? await normalizeImage(img.buf, img.mime).catch(() => null) : null;
      if (!norm) {
        counters.imagesFailed++;
        return;
      }
      const res = await this.uploads
        .ingestExternal({
          ownerId: user.id,
          model: 'User',
          modelId: user.id,
          fieldKey: 'gallery',
          buffer: norm.buf,
          mimetype: norm.mime,
          filename: t.url.split('/').pop() || `web-gallery-${t.i + 1}`,
          replace: false,
          metadata: { importedFrom: 'web-import', originalUrl: t.url },
        })
        .catch(() => null);
      if (res?.ok) counters.imagesDone++;
      else counters.imagesFailed++;
    });
    return true;
  }

  // ─── کالاها ───────────────────────────────────────────────────────────────

  /** به‌روزرسانی کالای خودِ کاربر — فقط قیمت/موجودی/حداقل سفارش + آشکارسازی.
   *  تصاویر و متن و وضعیت هرگز تغییر نمی‌کنند (خواستهٔ مالک: زحمت پاک‌سازی
   *  تصاویر قبلی حفظ شود؛ حذف‌شده زنده نمی‌شود). */
  private async updateMine(
    existing: { id: number; stock: number; minSalePrice: number; minSaleAmount: number; ownerHidden: boolean },
    it: ImportItem,
    userId: string,
  ): Promise<'updated' | 'shown' | 'unchanged'> {
    const priceChanged =
      existing.stock !== it.stock ||
      existing.minSalePrice !== it.minSalePrice ||
      existing.minSaleAmount !== it.minSaleAmount;
    const priceUpdatedAt = priceChanged
      ? bkDate(it.lastPriceIso) ?? bkDate(it.updatedAtIso) ?? new Date()
      : undefined;
    const needShow = existing.ownerHidden;

    if (!priceChanged && !needShow) return 'unchanged';

    await this.prisma.product.update({
      where: { id: existing.id },
      data: {
        ...(priceChanged ? { stock: it.stock, minSalePrice: it.minSalePrice, minSaleAmount: it.minSaleAmount } : {}),
        ...(priceUpdatedAt ? { priceUpdatedAt } : {}),
        ownerHidden: false,
      },
    });

    // سابقهٔ تغییر (رجوع در اختلاف‌ها) — فقط وقتی اعداد واقعاً عوض شدند
    if (priceChanged) {
      await this.prisma.productEditHistory.create({
        data: {
          productId: existing.id,
          userId,
          action: 'web-import',
          before: {
            stock: existing.stock,
            minSalePrice: existing.minSalePrice,
            minSaleAmount: existing.minSaleAmount,
          },
          after: { stock: it.stock, minSalePrice: it.minSalePrice, minSaleAmount: it.minSaleAmount },
        },
      });
    }
    return priceChanged ? 'updated' : 'shown';
  }

  /** انتقال کالای رهاشده (حساب جامدِ بی‌صاحب) به کاربر جاری + به‌روزرسانی.
   *  حساب فعال با تلفن واقعی هرگز خلع مالکیت نمی‌شود. */
  private async reassignIfOrphan(
    existing: { id: number; userId: string; stock: number; minSalePrice: number; minSaleAmount: number },
    it: ImportItem,
    userId: string,
  ): Promise<boolean> {
    const owner = await this.prisma.user.findUnique({
      where: { id: existing.userId },
      select: { phone: true, lastLoginAt: true },
    });
    if (!owner) return false;
    const realPhone = /^09\d{9}$/.test(owner.phone);
    if (realPhone && owner.lastLoginAt) return false; // حساب زنده — تعلق به دیگری است
    if (realPhone && !owner.lastLoginAt) {
      // تلفن واقعی ولی هرگز وارد نشده: فقط اگر همان شمارهٔ کاربر جاری است
      const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
      if (me?.phone !== owner.phone) return false;
    }

    const priceChanged =
      existing.stock !== it.stock ||
      existing.minSalePrice !== it.minSalePrice ||
      existing.minSaleAmount !== it.minSaleAmount;
    await this.prisma.product.update({
      where: { id: existing.id },
      data: {
        userId,
        ...(priceChanged
          ? {
              stock: it.stock,
              minSalePrice: it.minSalePrice,
              minSaleAmount: it.minSaleAmount,
              priceUpdatedAt: bkDate(it.lastPriceIso) ?? bkDate(it.updatedAtIso) ?? new Date(),
            }
          : {}),
        ownerHidden: false,
      },
    });
    if (priceChanged) {
      await this.prisma.productEditHistory.create({
        data: {
          productId: existing.id,
          userId,
          action: 'web-import',
          before: {
            stock: existing.stock,
            minSalePrice: existing.minSalePrice,
            minSaleAmount: existing.minSaleAmount,
          },
          after: { stock: it.stock, minSalePrice: it.minSalePrice, minSaleAmount: it.minSaleAmount },
        },
      });
    }
    return true;
  }

  /** ثبت کالای جدید — «در انتظار تایید» (تصاویر منبع باید بعداً توسط کاربر
   *  تعویض شود؛ عین سیاست مالک) + نگه‌داشتن مهرهای دقیق ثبت/قیمت منبع */
  private async createItem(
    userId: string,
    it: ImportItem,
    catById: Map<number, { parentId: number | null }>,
  ): Promise<void> {
    // دستهٔ پدر: اگر برگ زیر دستهٔ میانی است، پدر درستش را بگیر (عین ایمپورتر)
    let categoryId = it.categoryId;
    const sub = catById.get(it.subCategoryId);
    if (sub && sub.parentId != null) categoryId = sub.parentId;
    if (!catById.has(it.subCategoryId)) {
      await this.ensureCategory(it.subCategoryId, it.subCategoryName, it.categoryId, catById);
      await this.ensureCategory(it.categoryId, it.categoryName, null, catById);
      categoryId = it.categoryId;
    }

    const name = (it.name ?? '').trim();
    const bkUpdated = bkDate(it.updatedAtIso);
    const priceUpdatedAt = bkDate(it.lastPriceIso) ?? bkUpdated;
    const createdAt = bkDate(it.createdAtIso) ?? new Date();

    await this.prisma.product.create({
      data: {
        id: it.id,
        productName: name,
        slug: `فروش-عمده-${name}-${it.id}`,
        description: aimchifyBrandMentions(it.description),
        priceUpdatedAt: priceUpdatedAt ?? createdAt,
        // عین ایمپورتر: پنجرهٔ ۳روزه برای قیمت ماه‌ها/سال‌ها قدیمیِ منبع بی‌معناست
        priceValidityDays: 3650,
        categoryId,
        subCategoryId: it.subCategoryId,
        unit: it.unit || 'کیلوگرم',
        provinceId: it.provinceId,
        cityId: it.cityId,
        stock: it.stock,
        minSaleAmount: it.minSaleAmount,
        minSalePrice: it.minSalePrice,
        // ویژه شدن در آیمچ فقط با پرداخت واقعی — isElevated کپی نمی‌شود
        isElevated: false,
        hasVideo: !!it.hasVideo,
        status: 'pending',
        ownerHidden: false,
        userId,
        createdAt,
        updatedAt: bkUpdated ?? createdAt,
      },
    });

    // Counter باید از idهای منبع جلوتر بماند (الگوی seed)
    const cur = await this.prisma.counter.findUnique({ where: { id: 'product' } });
    const next = Math.max(cur?.seq ?? 0, it.id + 1000);
    await this.prisma.counter.upsert({
      where: { id: 'product' },
      update: { seq: next },
      create: { id: 'product', seq: next },
    });
  }

  /** تصاویر کالای جدید — از جزئیات منبع؛ همان مسیر/پردازش/واترمارک آپلود عادی */
  private async fetchItemPhotos(
    bk: BuskoolClient,
    session: WebImportSession,
    it: ImportItem,
    counters: WebImportCounters,
  ): Promise<number> {
    // اگر قبلاً برای این آگهی عکس ذخیره شده (ایمپورت قبلی ناقص)، دوباره نگیر
    const done = await this.prisma.file.findFirst({
      where: { relatedModel: 'Product', relatedId: String(it.id), fieldKey: 'gallery' },
      select: { id: true },
    });
    if (done) return 0;

    const detail = await this.callSource<BkProductDetailResp>(bk, '/get_product_by_id', {
      product_id: it.id,
    }).catch(() => null);
    const urls = (detail?.product?.photos ?? [])
      .map((p) => p.file_path)
      .filter(Boolean)
      .slice(0, MAX_PHOTOS_PER_PRODUCT);
    if (!urls.length) return 0;

    let ok = 0;
    await runPool(
      urls.map((url, i) => ({ url, i })),
      2,
      () => false,
      async (t) => {
        const img = await fetchImage(t.url, () => false).catch(() => null);
        const norm = img ? await normalizeImage(img.buf, img.mime).catch(() => null) : null;
        if (!norm) {
          counters.imagesFailed++;
          return;
        }
        const res = await this.uploads
          .ingestExternal({
            ownerId: session.userId,
            model: 'Product',
            modelId: String(it.id),
            fieldKey: 'gallery',
            buffer: norm.buf,
            mimetype: norm.mime,
            filename: t.url.split('/').pop() || `web-${it.id}-${t.i}`,
            replace: false,
            metadata: { importedFrom: 'web-import', originalUrl: t.url },
          })
          .catch(() => null);
        if (res?.ok) {
          counters.imagesDone++;
          ok++;
        } else counters.imagesFailed++;
      },
    );
    return ok;
  }

  // ─── ابزارهای مشترک (عین ایمپورتر ادمین) ─────────────────────────────────

  private async getCatById(): Promise<Map<number, { parentId: number | null }>> {
    if (!this.catCache) {
      const m = new Map<number, { parentId: number | null }>();
      for (const c of await this.prisma.category.findMany({ select: { id: true, parentId: true } })) {
        m.set(c.id, { parentId: c.parentId });
      }
      this.catCache = m;
    }
    return this.catCache;
  }

  /** ساخت زنجیرهٔ دستهٔ غایب (id عددی منبع) */
  private async ensureCategory(
    id: number,
    name: string,
    parentId: number | null,
    catById: Map<number, { parentId: number | null }>,
  ): Promise<void> {
    if (!id || catById.has(id)) return;
    await this.prisma.category
      .create({ data: { id, parentId, categoryName: name || `دسته ${id}`, slug: `cat-${id}` } })
      .catch(() => undefined); // رقابت — قبلاً ساخته شده
    catById.set(id, { parentId });
  }

  private async findLocation(type: 'province' | 'city', name: string, parentBuskolId?: number) {
    const parent = parentBuskolId != null ? await this.prisma.location.findFirst({ where: { type: 'province', buskolId: parentBuskolId }, select: { id: true } }) : null;
    return this.prisma.location.findFirst({
      where: { type, name, ...(parent ? { parentId: parent.id } : {}) },
      select: { buskolId: true },
    });
  }

  /** درصد پیشرفت از خودِ سند — فرانت با انیمیشن نرمش می‌کند */
  private percentOf(s: WebImportSession): number {
    if (s.status === 'done') return 100;
    const total = s.total || 0;
    switch (s.phase) {
      case 'search':
        return Math.min(12, Math.round(3 + (s.listFrom / 100) * 2));
      case 'profile':
        return 15;
      case 'gallery':
        return 18;
      case 'products':
        return total > 0 ? Math.min(98, 20 + Math.round((s.cursor / total) * 78)) : 98;
      default:
        return 0;
    }
  }

  /** سند → DTO پاسخ — فقط فیلدهای امن (بدون sourceUserName/جزئیات فنی) */
  private toProgress(s: WebImportSession, retry = false): WebImportProgress {
    const counters = { ...EMPTY_COUNTERS, ...readCounters(s.counters) };
    const log = readLog(s.log);
    return {
      status: s.status as WebImportProgress['status'],
      mode: s.mode as WebImportMode,
      phase: s.phase,
      percent: this.percentOf(s),
      processed: s.cursor,
      total: s.total,
      counters,
      log: log.slice(-8).map((l) => l.msg),
      ...(retry ? { retry: true, message: GENERIC_STEP_ERROR } : {}),
      ...(s.status === 'failed' && s.error ? { message: s.error } : {}),
    };
  }
}

// ─── پاسخ لیست منبع — فقط فیلدهای مصرفی ─────────────────────────────────────

interface BkProductListRespLike {
  products?: {
    main: {
      id: number;
      product_name: string;
      description: string;
      stock: number;
      min_sale_price: number;
      min_sale_amount: number;
      unit: string;
      category_id: number;
      sub_category_id: number;
      category_name: string;
      sub_category_name: string;
      province_id: number;
      city_id: number;
      is_elevated: number;
      has_video: boolean;
      is_rejected: number;
      deleted_at: string | null;
      p_created_at: string;
      updated_at: string;
      last_price_update: string;
    };
  }[];
}

/** فشرده‌سازی یک آیتم لیست برای ذخیره در سند جلسه */
function toItem(m: NonNullable<BkProductListRespLike['products']>[number]['main']): ImportItem {
  return {
    id: m.id,
    name: (m.product_name ?? '').trim(),
    description: descToText(m.description),
    stock: m.stock ?? 0,
    minSalePrice: m.min_sale_price ?? 0,
    minSaleAmount: m.min_sale_amount ?? 0,
    unit: m.unit || 'کیلوگرم',
    categoryId: m.category_id,
    subCategoryId: m.sub_category_id,
    categoryName: m.category_name ?? '',
    subCategoryName: m.sub_category_name ?? '',
    provinceId: m.province_id,
    cityId: m.city_id,
    isElevated: m.is_elevated,
    hasVideo: !!m.has_video,
    createdAtIso: m.p_created_at ?? null,
    updatedAtIso: m.updated_at ?? null,
    lastPriceIso: m.last_price_update ?? null,
  };
}

// ─── ابزارهای ماژول ─────────────────────────────────────────────────────────

/** تاریخ منبع ('2024-04-05 23:42:27') → Date؛ نامعتبر → null */
function bkDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

function line(msg: string): LogLine {
  return { t: Date.now(), msg };
}

function readLog(raw: unknown): LogLine[] {
  if (!Array.isArray(raw)) return [];
  return (raw as LogLine[]).filter((l) => l && typeof l.msg === 'string');
}

function pushLog(log: LogLine[], msg: string): LogLine[] {
  if (msg) log.push(line(msg));
  return log.slice(-MAX_LOG_LINES);
}

function readCounters(raw: unknown): Partial<WebImportCounters> {
  return (raw && typeof raw === 'object' ? raw : {}) as Partial<WebImportCounters>;
}

function readItems(raw: unknown): ImportItem[] {
  if (!Array.isArray(raw)) return [];
  return raw as ImportItem[];
}

/** عدد فارسی برای پیام‌های کاربر */
function fa(n: number): string {
  return n.toLocaleString('fa-IR');
}

/** پیام پایانی — جملهٔ دقیق مالک (۱۸-۱۱) */
function finalMessage(c: WebImportCounters): string {
  if (!c.found) return 'جستجو کامل شد؛ کالایی برای شما در وب پیدا نشد';
  const parts: string[] = [];
  if (c.created) parts.push(`${fa(c.created)} کالای جدید`);
  if (c.updated || c.reassigned) parts.push(`${fa(c.updated + c.reassigned)} کالا به‌روز`);
  return `کالاهای شما از سطح اینترنت جمع‌آوری و ایمپورت شد${parts.length ? ` (${parts.join(' + ')})` : ''}. اکنون می‌توانید قیمت، موجودی و مشخصات کالای خود را به‌روز کنید.`;
}
