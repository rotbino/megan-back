/**
 * سرویس ایمپورتر باسکول — مهاجرت دادهٔ یک کاربر باسکول (پروفایل، آواتار،
 * آگهی‌ها + عکس‌ها، کامنت‌ها) به دیتابیس ایمچ، با جاب پس‌زمینه و گزارش زنده.
 *
 * بازسازی ۱۳-۱۱ پس از گم‌شدن کد سشن قبل — قرارداد API عیناً از کلاینت فرانت
 * (megan-web src/lib/importer/client.ts) و تست E2E حفظ شده است؛ نگاشت فیلدها
 * مطابق اسکیمای فعلی (Prisma/Mongo، مدل‌های CamelCase) و scripts/seed-products.mjs.
 *
 * مشخصات:
 *   • جاب‌های درون‌حافظه‌ای با steps/log/counters + توقف ترکیبی — با refresh
 *     صفحه از بین نمی‌روند (سرور زنده است).
 *   • id آگهی همان id عددی باسکول (الگوی seed)؛ Counter روی max+1000.
 *   • عکس‌ها (خواستهٔ مالک ۱۳-۱۱): دانلود امن → UploadsService.ingestExternal —
 *     «دقیقاً همان مسیر/پردازش/واترمارک آپلود عادی کاربر»: کلید
 *     users/{userId}/products/{pid}/gallery/… و users/{userId}/avatars/avatar/…،
 *     ردیف File با storageKey کامل. هیچ فولدر جداگانهٔ باسکولی (لوکال یا
 *     ابری) ساخته نمی‌شود — انگار که آگهی توسط خود کاربر ایجاد شده.
 *   • نویسنده‌های کامنت «کاربر کمکی» (stub) می‌شوند — با ایمپورت واقعی بعدی
 *     همان bUserId ادغام می‌شوند.
 *   • پروفایل کسب‌وکار (خواستهٔ مالک ۱۳-۱۱): توضیحات به ستون businessDesc
 *     می‌رود (همان فرم ویرایش/کاتالوگ عمومی) و address/isCompany/companyName
 *     با همان کلیدهای استاندارد profile embedded ذخیره می‌شوند؛ متن خودکار
 *     باسکول/اینکوباک (isBuskoolAutoDesc) رد می‌شود — صفحهٔ آیمچ متن پارامتریک
 *     خودش (lib/seller-text فرانت) را نشان می‌دهد، نه کپی باسکول را.
 *   • برندگذاری قدیمی (خواستهٔ مالک ۱۳-۱۱): نام قدیمی سایت «اینکوباک» بوده و
 *     متن‌های خودکار با آن ساخته می‌شده‌اند؛ در متن‌های «خودِ کاربر» هر
 *     اشاره‌ای به باسکول/اینکوباک با «آیمچ» جایگزین می‌شود (توضیحات کسب‌وکار،
 *     توضیحات آگهی و متن کامنت‌ها) — aimchifyBrandMentions.
 *   • سند رفتار باسکول (خواستهٔ مالک ۱۳-۱۱): همهٔ فیلدهای ارزشمند باسکول
 *     (ویژه بودن + نوع بسته، آمار، دامنهٔ فعالیت، کیف پول، coming_from و…)
 *     در فیلد JSON «b» ذخیره می‌شود — b-user-data.ts. ⚠️ ویژه بودن باسکول
 *     هرگز به activePakageType آیمچ کپی نمی‌شود؛ کاربر در آیمچ رایگان
 *     می‌ماند تا خودش با پرداخت واقعی ویژه شود.
 *   • آواتار: منبع اصلی فیلد profile_photo در پاسخ load_profile_by_user_name
 *     است (کوکی همان‌جا هست)؛ اندپوینت get_user_last_confirmed_profile_photo
 *     فقط fallback است — عکس «تأییدنشده»ها را برنمی‌گرداند.
 *   • تصاویر کسب‌وکار (خواستهٔ مالک ۱۴-۱۱): عکس‌های «مربوطهٔ» پروفایل باسکول
 *     (relateds) به اسلات استاندارد گالری کاربر rehost می‌شوند
 *     (users/{userId}/avatars/gallery/…) تا کاتالوگ عمومی (/c/…) آنها را
 *     نشان دهد؛ کاربران قدیمی هم در اجرای بعدی لیست، از همان URLهای
 *     b.relateds بازآوری می‌شوند (idempotent با metadata.originalUrl).
 *   • سرعت (خواستهٔ مالک ۱۴-۱۱ — «سریع‌تر، بدون بلاک شدن باسکول»):
 *     درخواست‌های مستقل باسکول هم‌زمان شروع می‌شوند (گیت نرخ با فاصلهٔ
 *     کوتاه بین «شروع» درخواست‌ها + سقف هم‌زمانی + عقب‌نشینی خودکار روی
 *     429/403 — buskool.client.ts)، جزئیات آگهی‌ها موازی گرفته می‌شوند و
 *     همهٔ تصاویر (آواتار + کسب‌وکار + آگهی‌ها) در یک استخر موازی مشترک
 *     دانلود/پردازش/ذخیره می‌شوند. جزئیات معماری: ابتدای importOneUser.
 *   • سیاست خطای رکورد (خواستهٔ مالک ۱۵-۱۱): خطای هر کاربر (مثل حساب
 *     پاک‌شدهٔ باسکول) جاب را نمی‌اندازد — با دلیلش روی خود رکورد ذخیره
 *     می‌شود و بقیهٔ کاربران ادامه می‌یابند؛ قطعی اینترنت فقط وقفه است
 *     (net-watch) و تنها تکرار پیاپیِ همین خطا (پیش‌فرض ۱۰ بار) نشانهٔ
 *     مشکل سیستمی است و جاب را می‌بُرد.
 */
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { buildStorage } from '../uploads/storage';
import { UploadsService } from '../uploads/uploads.service';
import sharp from 'sharp';
import { storage } from '../common/config/env';
import {
  BuskoolClient,
  buskoolConfig,
  buskoolPace,
  buskoolSessionLoggedIn,
  type BkAvatarResp,
  type BkCommentsResp,
  type BkProductDetailResp,
  type BkProductItem,
  type BkProductListResp,
  type BkProfileResp,
  type BkStatsResp,
} from './buskool.client';
import { importerAdminPhone } from './dto';
import { descToText } from './desc-text';
import { cleanBuskoolWatermark } from './buskool-wm-clean';
import { asBUserData, bkPackageTitle, type BUserData } from './b-user-data';
import {
  isNetworkError,
  netWaitingNow,
  netWaitSince,
  onNetTransition,
  waitForOnline,
  withNetRetry,
} from './net-watch';

// ─── تایپ‌های جاب (قرارداد فرانت) ───────────────────────────────────────────

type JobStatus = 'running' | 'done' | 'failed' | 'stopped';
type StepStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface ImportStep {
  key: string;
  label: string;
  status: StepStatus;
}

export interface LogLine {
  t: number;
  msg: string;
  level: 'info' | 'success' | 'warn' | 'error';
}

export interface ImportJob {
  id: string;
  kind: 'single' | 'list';
  status: JobStatus;
  userName?: string;
  totalUsers?: number;
  currentUserIndex?: number;
  currentUser?: string;
  usersDone?: number;
  usersFailed?: number;
  steps: ImportStep[];
  log: LogLine[];
  counters: Record<string, number>;
  result?: Record<string, unknown>;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  /** (۱۵-۱۱ شب) نگهبان شبکه: همین حالا در انتظار بازگشت اینترنت است —
   *  جاب متوقف نشده، فقط نگه داشته شده و بعد از وصل شدن از همان‌جا ادامه می‌یابد */
  netWaiting?: boolean;
  /** از چه لحظه‌ای منتظر شبکه مانده (مهر یونیکس ms) */
  netWaitSince?: number | null;
  /** (۱۶-۱۱) توقف موقت دلسوله: درخواست pause ثبت شده و در نزدیک‌ترین
   *  ایستگاه امن، حلقهٔ اجرا منتظر ادامه می‌ماند — جاب «در حال اجرا» است
   *  ولی هیچ درخواستی به باسکول/دیتابیس زده نمی‌شود */
  paused?: boolean;
  /** (۱۶-۱۱) درخواست توقف ثبت شده — بین درخواست‌ها اعمال می‌شود؛ دوبار زدن
   *  دکمهٔ توقف = توقف فوری (قطع همین‌جا). برای نمایش «توقف فوری» در پنل */
  stopRequested?: boolean;
}

interface JobInternal extends ImportJob {
  stopRequested: boolean;
  /** (۱۶-۱۱) درخواست توقف موقت — در ایستگاه‌های امن برسی می‌شود */
  pauseRequested: boolean;
  buskoolRequests: number;
}

const STEP_DEFS: { key: string; label: string }[] = [
  { key: 'profile', label: 'پروفایل و ساخت کاربر' },
  { key: 'avatar', label: 'آواتار' },
  { key: 'relateds', label: 'تصاویر کسب‌وکار' },
  { key: 'products', label: 'آگهی‌ها' },
  { key: 'images', label: 'تصاویر آگهی‌ها' },
  { key: 'reviews', label: 'کامنت‌ها' },
];

const MAX_JOBS = 50;
const PAGE = 20; // اندازهٔ صفحهٔ لیست آگهی‌های باسکول
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_PHOTOS_PER_PRODUCT = 4;
/** سقف تصاویر کسب‌وکار هر کاربر — همان سقف گالری فرم ویرایش پروفایل (۸) */
const MAX_RELATEDS_PER_USER = 8;
/** آپ‌سرت‌های مستقل DB در هر دستهٔ موازی کوچک */
const DB_CHUNK = 8;

// ─── سیاست خطای رکورد (خواستهٔ مالک ۱۵-۱۱) ────────────────────────────────
//
// «وقتی خطا خوردی ببین چی هست: اگر مالِ همین رکورد است متوقف نشو — ذخیره‌اش
// کن برای رسیدگی بعدی و برو سراغ رکورد بعدی. قطعی اینترنت که درست کار
// می‌کند (نگهبان شبکه). فقط اگر همین خطا ۱۰ بار پشت‌سرهم تکرار شد
// شک کن و ببُر.» — اجرای سیاست در runList؛ امضای خطا همین‌جا ساخته می‌شود.

/** عدد صحیح مثبت از env با پیش‌فرض */
function envInt(name: string, def: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : def;
}

/**
 * امضای خطا — «نوعِ» خطا بدون جزئیات رکورد (یوزرنیم/عدد/نقل‌قول) تا
 * خطاهای یکسانِ رکوردهای مختلف هم‌امضا دیده شوند و قانون «تکرار پیاپی
 * همین خطا» کار کند: کاربر پاک‌شدهٔ باسکول → user-not-found، هر ۴۰۴ →
 * http-404، پاسخ HTML نیازمند کوکی → html-cookie، خطای Prisma → prisma-P2xxx.
 */
export function importErrorSignature(err: unknown): string {
  const msg = String((err as Error)?.message ?? err);
  if (msg.includes('کاربر باسکول') && msg.includes('پیدا نشد')) return 'user-not-found';
  const http = msg.match(/HTTP (\d{3})/);
  if (http) return `http-${http[1]}`;
  if (msg.includes('پاسخ HTML')) return 'html-cookie';
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string' && /^P\d{4}$/.test(code)) return `prisma-${code}`;
  const prismaCode = msg.match(/\bP\d{4}\b/);
  if (prismaCode) return `prisma-${prismaCode[0]}`;
  return (
    msg
      .replace(/@[^\s،)]+/g, '@user')
      .replace(/https?:\/\/\S+/g, 'url')
      .replace(/\/[a-zA-Z0-9_.\-]+(?:\/[a-zA-Z0-9_.\-]+)*/g, 'path')
      .replace(/["'«»][^"'«»]*["'«»]/g, '…')
      .replace(/\d+/g, '#')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, 90) || 'unknown'
  );
}

@Injectable()
export class ImporterService {
  /** کش دسته‌ها — بارگذاری یک‌بار؛ ensureCategory خودش تازه‌سازی می‌کند.
   *  قبلاً به‌ازای هر کاربر یک findMany کامل روی جدول دسته‌ها می‌رفت (جاب
   *  لیستی ۵۰۰ نفره = ۵۰۰ کوئری اضافه). با cleanup باطل می‌شود. */
  private catCache: Map<number, { parentId: number | null }> | null = null;
  /** کش استان/شهر به نام — جدول locations تغییرناپذیر است؛ findFirst های
   *  تکراری هر کاربر (۲ تا) در جاب لیستی حذف می‌شود */
  private readonly locCache = new Map<string, { id: string; buskolId: number | null } | null>();
  private readonly logger = new Logger(ImporterService.name);
  private readonly jobs = new Map<string, JobInternal>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {
    // نگهبان شبکه (۱۵-۱۱ شب): گذار قطع/وصل روی جابِ در حال اجرا لاگ و فیلد
    // می‌شود تا پنل زنده نشان دهد «ایمپورت متوقف نشده — فقط منتظر اینترنت است»
    onNetTransition((waiting, since) => {
      const job = [...this.jobs.values()].find((j) => j.status === 'running');
      if (!job) return;
      job.netWaiting = waiting;
      job.netWaitSince = waiting ? since : null;
      this.log(
        job,
        waiting ? 'warn' : 'success',
        waiting
          ? '⏳ اتصال شبکه قطع شد — ایمپورت همین‌جا نگه داشته شد و بعد از وصل شدن اینترنت از همان‌جا ادامه می‌یابد…'
          : '✓ شبکه برگشت — ادامهٔ ایمپورت از همان‌جا',
      );
    });
  }

  // ═══════════════════════════ وضعیت ‌و آمار ═══════════════════════════

  async ping() {
    const { delayMs, cookie } = buskoolConfig();
    return {
      ok: true,
      delayMs,
      busy: [...this.jobs.values()].some((j) => j.status === 'running'),
      cookieSet: cookie.length > 0,
      // سلامت سشن (۱۵-۱۱): کوکی مهمان هم cookieSet:true می‌دهد ولی چیزی
      // باز نمی‌کند — این فیلد نشان می‌دهد سشن واقعاً لاگین است یا نه
      // (null = بدون کوکی/خطای شبکه؛ یک تماس در عمر پروسه، کش‌شده).
      cookieLoggedIn: await buskoolSessionLoggedIn(),
      adminPhone: importerAdminPhone(),
      // نگهبان شبکه (۱۵-۱۱ شب): آیا همین حالا منتظر بازگشت اینترنت هستیم؟
      // فقط وقتی جابی در حال اجراست معنادار است (کسی سنجش نمی‌کند تا وقتی
      // عملی منتظر بماند) — برای نشان‌دادن «توقف موقت» در نوار وضعیت پنل
      netWaiting: netWaitingNow(),
      // درایور ذخیرهٔ عکس‌ها — همان درایور آپلود عادی؛ عکس‌های باسکول دقیقاً
      // در همان جا (users/{userId}/…) می‌نشینند. فرانت نشان می‌دهد.
      storageDriver: storage.DRIVER,
      // وضعیت گامِ فعلی باسکول (۱۴-۱۱): فاصلهٔ مؤثر (بعد از عقب‌نشینی‌ها)،
      // هم‌زمانی و ضریب ادب — برای مشاهدهٔ زندهٔ رفتار ایمپورتر در پنل
      pace: buskoolPace(),
    };
  }

  async stats() {
    const [users, products, photos, reviews, bComments, buyRequests, chats, savedUsers, serviceInterests] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.product.count(),
        this.prisma.file.count(),
        this.prisma.sellerReview.count(),
        this.prisma.bComment.count(),
        this.prisma.buyRequest.count(),
        this.prisma.chatThread.count(),
        this.prisma.followItem.count(),
        this.prisma.serviceSignup.count(),
      ]);
    return { users, products, photos, reviews: reviews + bComments, bComments, buyRequests, chats, savedUsers, serviceInterests };
  }

  /**
   * دیتابیس منبع — کالکشن user-buskool در «همان دیتابیس» ایمچ (خواستهٔ مالک
   * ۱۳-۱۱: جدول را خودش با دامپ کاربران باسکول ساخته؛ دیگر دیتابیس جانبی
   * لازم نیست). خواندن با $runCommandRaw تا شکل سندهای دامپ (فیلدهای اضافی)
   * مهم نباشد و فقط ستون‌های یوزرنیم/تلفن خوانده شود.
   */
  private sourceTable() {
    return process.env.IMPORT_SOURCE_TABLE?.trim() || 'user-buskool';
  }

  /** کش ستون‌های تشخیص‌داده‌شدهٔ کالکشن منبع — هر جدول یک‌بار در عمر پروسه */
  private sourceColumnsCache: { table: string; userName: string; phone: string; keys: string[] } | null = null;

  /**
   * ستون‌های یوزرنیم/تلفن کالکشن منبع — ترتیب اولویت: env صریح، تشخیص خودکار
   * از کلیدهای سند نمونه، پیش‌فرض. ریشهٔ باگ ۱۳-۱۱: دامپ واقعی باسکول فیلد
   * «userName» (camelCase) دارد ولی پیش‌فرض قبلی user_name بود — find سند را
   * برمی‌گرداند ولی فیلتر JS همهٔ ردیف‌ها را می‌انداخت و خطای «ردیفی نبود»
   * می‌داد (با کالکشن ۵۵هزارتایی!). با تشخیص خودکار، جورشدن نام ستون دیگر
   * به حافظهٔ ما و مالک وابسته نیست.
   */
  private async sourceFields(): Promise<{ userName: string; phone: string; keys: string[] }> {
    const table = this.sourceTable();
    if (this.sourceColumnsCache?.table !== table) {
      let userName = 'userName';
      let phone = 'phone';
      let keys: string[] = [];
      try {
        const res = (await this.prisma.$runCommandRaw({
          find: table,
          limit: 1,
          batchSize: 1,
        })) as unknown as { cursor?: { firstBatch?: Record<string, unknown>[] } };
        const doc = res?.cursor?.firstBatch?.[0];
        if (doc) {
          keys = Object.keys(doc);
          const userKey =
            ['userName', 'user_name', 'username'].find((k) => keys.includes(k)) ??
            keys.find((k) => /^user[-_]?name$/i.test(k));
          const phoneKey =
            ['phone', 'mobile', 'phone_number'].find((k) => keys.includes(k)) ??
            keys.find((k) => /^(phone|mobile|cell)[-_]?(number)?$/i.test(k));
          if (userKey) userName = userKey;
          if (phoneKey) phone = phoneKey;
        }
      } catch {
        // کالکشن خالی/ناخوانا — پیش‌فرض‌ها می‌مانند؛ خطای واقعی در sourceRead دیده می‌شود
      }
      this.sourceColumnsCache = { table, userName, phone, keys };
    }
    const c = this.sourceColumnsCache;
    return {
      userName: process.env.IMPORT_SOURCE_USERNAME_COLUMN?.trim() || c.userName,
      phone: process.env.IMPORT_SOURCE_PHONE_COLUMN?.trim() || c.phone,
      keys: c.keys,
    };
  }

  /**
   * خواندن دسته‌ای از کالکشن منبع، مرتب بر اساس _id (ایندکس‌دار). سورت روی
   * ستون بی‌ایندکس (مثل userName) در آتلاس با «Sort exceeded memory limit
   * 32MB» می‌ترکد — با skip بزرگ، بافر سورت به حد کل کالکشن می‌رسد (کاوش
   * ۱۳-۱۱). rawIdx = جایگاه «سند خام» (قبل از حذف ردیف‌های بدون یوزرنیم)
   * تا offset پیمایش همیشه روی سند خام بماند؛ rawCount هم برای همین است.
   */
  private async sourceRead(
    offset: number,
    limit: number,
  ): Promise<{ rows: { userName: string; phone: string | null; rawIdx: number }[]; rawCount: number }> {
    const { userName: uf, phone: pf } = await this.sourceFields();
    const res = (await this.prisma.$runCommandRaw({
      find: this.sourceTable(),
      sort: { _id: 1 },
      skip: offset,
      limit,
      batchSize: limit,
      // اگر روزی سورت روی ستون دیگری رفت، دیسک مجاز است تا حافظه نترکد
      allowDiskUse: true,
      projection: { [uf]: 1, [pf]: 1 },
    })) as unknown as { cursor?: { firstBatch?: Record<string, unknown>[] } };
    const batch = res?.cursor?.firstBatch ?? [];
    const rows = batch
      .map((d, i) => {
        const userName = String(d[uf] ?? '').trim();
        const rawPhone = d[pf] == null ? '' : String(d[pf]).replace(/[^0-9]/g, '');
        return { userName, phone: /^09\d{9}$/.test(rawPhone) ? rawPhone : null, rawIdx: offset + i };
      })
      .filter((r) => r.userName.length > 0);
    return { rows, rawCount: batch.length };
  }

  /**
   * پیام خطای خودتوضیح‌شونده برای خواندنِ خالی — سه حالت را از هم جدا می‌کند:
   * کالکشن خالی/ناوجود، گذشته از پایان لیست، و ناهماهنگی نام ستون یوزرنیم
   * (باگ ۱۳-۱۱: ۵۵هزار سند بود ولی «ردیفی نبود» می‌گرفتیم).
   */
  private async sourceEmptyError(offset: number, limit: number): Promise<string> {
    const base = `ردیفی در کالکشن ${this.sourceTable()} از offset=${offset} نبود`;
    try {
      const { userName: uf } = await this.sourceFields();
      const total = await this.sourceCount();
      if (total === 0) {
        return `${base} — کالکشن در دیتابیسی که برنامه به آن وصل است خالی است یا وجود ندارد (شمارش: ۰)`;
      }
      if (offset >= total) {
        return `${base} — کل لیست ${total.toLocaleString('fa-IR')} ردیف است و offset=${offset} از پایان آن گذشته`;
      }
      const raw = (await this.prisma.$runCommandRaw({
        find: this.sourceTable(),
        sort: { _id: 1 },
        skip: offset,
        limit,
        batchSize: limit,
        allowDiskUse: true,
      })) as unknown as { cursor?: { firstBatch?: Record<string, unknown>[] } };
      const batch = raw?.cursor?.firstBatch ?? [];
      if (batch.length) {
        const docKeys = Object.keys(batch[0]);
        return (
          `${base} — سند در این بازه هست (${batch.length} سند از ${total.toLocaleString('fa-IR')}) ` +
          `ولی ستون یوزرنیم «${uf}» در سندها مقدار ندارد؛ کلیدهای سند اول: ${docKeys.slice(0, 15).join('، ')} — ` +
          `نام درست را با IMPORT_SOURCE_USERNAME_COLUMN تنظیم کنید`
        );
      }
      return `${base} — خواندن خام در این بازه خالی برگشت (کل کالکشن: ${total.toLocaleString('fa-IR')} سند)`;
    } catch {
      return `${base} — شاید به انتهای لیست رسیده‌اید`;
    }
  }

  /** تعداد کل ردیف‌های کالکشن منبع */
  private async sourceCount(): Promise<number> {
    const res = (await this.prisma.$runCommandRaw({ count: this.sourceTable() })) as unknown as { n?: number };
    return Number(res?.n ?? 0);
  }

  async sourceInfo(): Promise<{
    connected: boolean;
    reason?: string;
    table?: string;
    phoneColumn?: string;
    userNameColumn?: string;
    /** کلیدهای واقعی سند نمونه — عیب‌یابی فوری ناهماهنگی نام ستون */
    rawKeys?: string[];
    total?: number;
    imported?: number;
    failed?: number;
    sample?: { phone: string; userName: string }[];
  }> {
    const table = this.sourceTable();
    try {
      const total = await this.sourceCount();
      if (total === 0) {
        return { connected: false, table, reason: `کالکشن ${table} در دیتابیس فعلی خالی است یا وجود ندارد` };
      }
      const fields = await this.sourceFields();
      const [{ rows: sample }, imported, failed] = await Promise.all([
        this.sourceRead(0, 5),
        this.prisma.user.count({ where: { bUserName: { not: null } } }),
        this.prisma.user.count({ where: { failedImport: true } }),
      ]);
      return {
        connected: true,
        table,
        phoneColumn: fields.phone,
        userNameColumn: fields.userName,
        rawKeys: fields.keys,
        total,
        imported,
        failed,
        sample: sample.map((r) => ({ userName: r.userName, phone: r.phone ?? '' })),
      };
    } catch (err) {
      return { connected: false, table, reason: `خواندن کالکشن ${table} ناموفق: ${(err as Error).message}` };
    }
  }

  /**
   * اولین کاربر منبع که هنوز ایمپورت نشده + آمار ادامه — پرکردن خودکار
   * «از ردیف» فرانت (خواستهٔ مالک: ادامه از همان‌جا که مانده).
   */
  async nextUnimported(): Promise<{
    found: boolean;
    offset: number;
    userName?: string;
    total: number;
    importedCount: number;
    remaining: number;
    reason?: string;
  }> {
    const total = await this.sourceCount();
    if (total === 0) {
      return {
        found: false,
        offset: 0,
        total: 0,
        importedCount: 0,
        remaining: 0,
        reason: `کالکشن ${this.sourceTable()} خالی است یا وجود ندارد`,
      };
    }

    const importedRows = await this.prisma.user.findMany({
      where: { bUserName: { not: null } },
      select: { bUserName: true },
    });
    const imported = new Set(importedRows.map((u) => u.bUserName as string));

    let first: { offset: number; userName: string } | null = null;
    let remaining = 0;
    let scanned = 0; // پیمایش روی «سند خام» — ردیف‌های بدون یوزرنیم هم جلو می‌روند
    while (scanned < total) {
      const { rows, rawCount } = await this.sourceRead(scanned, 5000);
      if (!rawCount) break;
      for (const r of rows) {
        if (imported.has(r.userName)) continue;
        remaining++;
        if (!first) first = { offset: r.rawIdx, userName: r.userName };
      }
      scanned += rawCount;
    }

    if (!first) {
      return {
        found: false,
        offset: total,
        total,
        importedCount: imported.size,
        remaining: 0,
        reason: 'همهٔ کاربران منبع ایمپورت شده‌اند',
      };
    }
    return {
      found: true,
      offset: first.offset,
      userName: first.userName,
      total,
      importedCount: imported.size,
      remaining,
    };
  }

  /** شمارهٔ تلفن از کالکشن منبع — پرکردن خودکار شمارهٔ تستر تک‌کاربره */
  private async sourcePhoneFor(userName: string): Promise<string | null> {
    try {
      const { userName: uf, phone: pf } = await this.sourceFields();
      const res = (await this.prisma.$runCommandRaw({
        find: this.sourceTable(),
        filter: { [uf]: userName },
        limit: 1,
        batchSize: 1,
        projection: { [pf]: 1 },
      })) as unknown as { cursor?: { firstBatch?: Record<string, unknown>[] } };
      const raw = res?.cursor?.firstBatch?.[0]?.[pf];
      const phone = raw == null ? '' : String(raw).replace(/[^0-9]/g, '');
      return /^09\d{9}$/.test(phone) ? phone : null;
    } catch {
      return null;
    }
  }

  // ═══════════════════════════ گیت ادمین ═══════════════════════════

  private assertAdmin(adminPhone: string) {
    if (adminPhone !== importerAdminPhone()) {
      throw new ForbiddenException('ایمپورتر فقط برای حساب ادمین در دسترس است');
    }
  }

  // ═══════════════════════════ جاب‌ها ═══════════════════════════

  getJob(id: string): ImportJob | null {
    const job = this.jobs.get(id);
    if (job && job.status === 'running') {
      // وضعیت زندهٔ نگهبان شبکه — بدون این، جابِ منتظر پس از اولین پاسخ
      // stale می‌شد (فقط گذارها از listener می‌رسند؛ سنجش همیشه به‌روز است)
      job.netWaiting = netWaitingNow();
      job.netWaitSince = netWaitSince();
    }
    return job ?? null;
  }

  /**
   * توقف جاب (خواستهٔ مالک ۱۶-۱۱: «هر موقع خواستم استاپ کنم — حتی وقتی
   * خطا خورده»):
   *  · در حال اجرا → توقف دلسوله: بین درخواست‌های بعدی قطع می‌شود؛
   *  · دوبار زدن (stopRequested از قبل true) → توقف فوری: وضعیت همین
   *    لحظه «stopped» می‌شود — برای جاب گیرکرده (مثلاً فریز سرورلس)؛
   *    حلقهٔ زنده در نخستین ایستگاه failJob را با status≠running رد می‌کند؛
   *  · جاب تمام‌شده (done/failed/stopped) → پاسخ صریح با وضعیت نهایی —
   *    دکمهٔ توقف همیشه کار می‌کند و پنل منسجم می‌ماند.
   */
  stopJob(id: string, adminPhone: string): { stopped: boolean; status: string; mode?: 'graceful' | 'forced' | 'already-finished' } {
    this.assertAdmin(adminPhone);
    const job = this.jobs.get(id);
    if (!job) return { stopped: false, status: 'not-found' };
    if (job.status !== 'running') {
      return { stopped: true, status: job.status, mode: 'already-finished' };
    }
    if (job.stopRequested) {
      // توقف فوری — دکمهٔ دوم: جاب همین‌جا قطع می‌شود (جاب گیرکرده/فریزشده)
      job.status = 'stopped';
      job.paused = false;
      job.pauseRequested = false;
      job.netWaiting = false;
      job.netWaitSince = null;
      job.finishedAt = Date.now();
      job.counters['buskoolRequests'] = job.buskoolRequests;
      this.log(job, 'warn', 'توقف فوری — جاب همین‌جا قطع شد (داده‌های ثبت‌شده حفظ شدند)');
      return { stopped: true, status: job.status, mode: 'forced' };
    }
    job.stopRequested = true;
    this.log(job, 'info', 'درخواست توقف ثبت شد — بین درخواست‌های بعدی متوقف می‌شود (دوباره بزنید = توقف فوری)');
    return { stopped: true, status: job.status, mode: 'graceful' };
  }

  /** توقف موقت (۱۶-۱۱) — جاب در نخستین ایستگاه امن می‌ایستد و منتظر ادامه می‌ماند */
  pauseJob(id: string, adminPhone: string): { paused: boolean; status: string } {
    this.assertAdmin(adminPhone);
    const job = this.jobs.get(id);
    if (!job) return { paused: false, status: 'not-found' };
    if (job.status !== 'running') return { paused: false, status: job.status };
    if (!job.paused && !job.pauseRequested) {
      job.pauseRequested = true;
      this.log(job, 'info', '⏸ درخواست توقف موقت ثبت شد — در نخستین ایستگاه امن می‌ایستد');
    }
    return { paused: true, status: job.status };
  }

  /** ادامه بعد از توقف موقت (۱۶-۱۱) — از همان ایستگاه ادامه می‌یابد */
  resumeJob(id: string, adminPhone: string): { resumed: boolean; status: string } {
    this.assertAdmin(adminPhone);
    const job = this.jobs.get(id);
    if (!job) return { resumed: false, status: 'not-found' };
    if (job.status !== 'running') return { resumed: false, status: job.status };
    if (job.paused || job.pauseRequested) {
      job.pauseRequested = false;
      job.paused = false;
      this.log(job, 'success', '▶ ادامهٔ ایمپورت از همان‌جا');
    }
    return { resumed: true, status: job.status };
  }

  /**
   * ایستگاه امن توقف موقت (۱۶-۱۱) — در هر مرز عملیات (کاربر/صفحهٔ آگهی/
   * عکس/قطعهٔ لیست) صدا زده می‌شود: اگر pause درخواست شده، جاب همین‌جا
   * می‌ایستد (بدون هیچ تماس با باسکول/دیتابیس) تا resume یا stop بیاید.
   * stop در حین مکث هم فوراً جواب می‌گیرد (JOB_STOPPED پرتاب می‌شود).
   */
  private async waitWhilePaused(job: JobInternal): Promise<void> {
    if (!job.pauseRequested && !job.paused) return;
    if (!job.paused) {
      job.paused = true;
      this.log(job, 'info', '⏸ ایمپورت موقتاً متوقف شد — با «ادامه» از همین‌جا برمی‌گردد');
    }
    while (job.paused && !job.stopRequested) {
      await sleep(400);
    }
    // استاپ در حین مکث — همین‌جا و بی‌درنگ قطع کن (ایستگاه امنیم)
    if (job.stopRequested) throw new Error('JOB_STOPPED');
    job.paused = false; // ادامه داده شد — پرچم نمایشی پایین بیاید
  }

  startSingle(input: { adminPhone: string; userName: string; phone?: string; maxProducts?: number }) {
    this.assertAdmin(input.adminPhone);
    if ([...this.jobs.values()].some((j) => j.status === 'running')) {
      throw new ForbiddenException('یک جاب ایمپورت در حال اجراست — اول منتظر بمانید یا آن را متوقف کنید');
    }
    const job = this.newJob('single', input.userName);
    void this.runSingle(job, input).catch((err) => this.failJob(job, err));
    return { jobId: job.id };
  }

  startList(input: { adminPhone: string; offset?: number; limit?: number; maxProductsPerUser?: number }) {
    this.assertAdmin(input.adminPhone);
    if ([...this.jobs.values()].some((j) => j.status === 'running')) {
      throw new ForbiddenException('یک جاب ایمپورت در حال اجراست — اول منتظر بمانید یا آن را متوقف کنید');
    }
    const job = this.newJob('list');
    void this.runList(job, input).catch((err) => this.failJob(job, err));
    return { jobId: job.id };
  }

  private newJob(kind: 'single' | 'list', userName?: string): JobInternal {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const job: JobInternal = {
      id,
      kind,
      status: 'running',
      userName,
      steps: STEP_DEFS.map((s) => ({ ...s, status: 'pending' as StepStatus })),
      log: [],
      counters: {},
      startedAt: Date.now(),
      stopRequested: false,
      pauseRequested: false,
      paused: false,
      buskoolRequests: 0,
    };
    this.jobs.set(id, job);
    // فقط آخرین MAX_JOBS جاب نگه داشته می‌شود
    if (this.jobs.size > MAX_JOBS) {
      const oldest = [...this.jobs.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt)[0];
      if (oldest && oldest[1].status !== 'running') this.jobs.delete(oldest[0]);
    }
    return job;
  }

  private log(job: JobInternal, level: LogLine['level'], msg: string) {
    job.log.push({ t: Date.now(), msg, level });
    if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
    (level === 'error' ? console.error : console.log).call(console, `[importer ${job.id}] ${msg}`);
  }

  private step(job: JobInternal, key: string, status: StepStatus) {
    const s = job.steps.find((x) => x.key === key);
    if (s) s.status = status;
  }

  private bump(job: JobInternal, key: string, by = 1) {
    job.counters[key] = (job.counters[key] ?? 0) + by;
  }

  private failJob(job: JobInternal, err: unknown) {
    if (job.status !== 'running') return;
    job.netWaiting = false;
    job.netWaitSince = null;
    job.paused = false; // پرچم نمایشی توقف موقت دیگر معنا ندارد
    const msg = (err as Error)?.message ?? String(err);
    if (msg === 'JOB_STOPPED') {
      job.status = 'stopped';
      job.finishedAt = Date.now();
      this.log(job, 'warn', 'جاب متوقف شد');
    } else {
      job.status = 'failed';
      job.finishedAt = Date.now();
      job.error = msg;
      this.log(job, 'error', `خطا: ${msg}`);
      this.logger.error(`job ${job.id} failed: ${msg}`);
    }
    job.buskoolRequests > 0 && (job.counters[`buskoolRequests`] = job.buskoolRequests);
  }

  private finishJob(job: JobInternal) {
    job.status = 'done';
    job.netWaiting = false;
    job.netWaitSince = null;
    job.finishedAt = Date.now();
    job.counters['buskoolRequests'] = job.buskoolRequests;
    this.log(job, 'success', 'ایمپورت کامل شد ✓');
  }

  /** مقاوم‌سازی در برابر قطعی اینترنت (خواستهٔ مالک ۱۵-۱۱ شب): خطای شبکه‌ای
   *  = توقف موقت و بازتلاش همان عملیات بعد از وصل شدن — نه شکستِ کاربر و نه
   *  سوزاندن قانون ۳ شکست پیاپی. عملیات‌های ایمپورتر idempotent هستند. */
  private netRetry<T>(job: JobInternal, fn: () => Promise<T>): Promise<T> {
    return withNetRetry(fn, {
      stop: () => job.stopRequested,
      onWait: (err) =>
        this.log(
          job,
          'warn',
          `⏳ شبکه قطع است (${String((err as Error)?.message ?? err).slice(0, 90)}) — منتظر وصل شدن برای ادامه از همین‌جا…`,
        ),
    });
  }

  // ═══════════════════════════ اجرا ═══════════════════════════

  private async runSingle(job: JobInternal, input: { userName: string; phone?: string; maxProducts?: number }) {
    const bk = new BuskoolClient(() => job.stopRequested);
    await this.waitWhilePaused(job);
    const user = await this.netRetry(job, () =>
      this.importOneUser(job, bk, input.userName, input.phone, input.maxProducts ?? 0),
    );
    job.buskoolRequests = bk.requests;
    if (job.stopRequested) throw new Error('JOB_STOPPED');
    job.result = { userName: user.userName, userId: user.id, phone: user.phone };
    this.finishJob(job);
  }

  private async runList(
    job: JobInternal,
    input: { offset?: number; limit?: number; maxProductsPerUser?: number },
  ) {
    // خواندن لیست از کالکشن user-buskool — همان دیتابیس ایمچ (خواستهٔ مالک ۱۳-۱۱)
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 5;

    // قطعه‌بندی خودکار (خواستهٔ مالک ۱۵-۱۱: «۱۰۰۰ و ۱۰۰۰۰ هم قبول کن؛ خودش
    // ۲۰۰تای اول را که تمام کرد بره ۲۰۰تای بعدی») — منبع در قطعه‌های ۲۰۰تایی
    // خوانده می‌شود (حافظهٔ ثابت، نوار پیشرفت روان) و همه در «یک جاب» دنباله‌دنباله
    // اجرا می‌شود. سقف ۲۰۰ قبلی از DTO هم برداشته شد.
    const CHUNK = 200;

    // نوار پیشرفت: کلِ درخواستی، مشخّص به باقی‌ماندهٔ واقعی منبع — منبع که
    // زودتر تمام شود همان عددِ کوچکتر ملاک است (شمارش، یک کوئری سبک)
    const sourceTotal = await this.netRetry(job, () => this.sourceCount()).catch(() => 0);
    job.totalUsers = Math.max(1, Math.min(limit, Math.max(0, sourceTotal - offset) || limit));
    job.usersDone = 0;
    job.usersFailed = 0;
    this.log(
      job,
      'info',
      `ایمپورت ${job.totalUsers.toLocaleString('fa-IR')} کاربر از ردیف ${offset} کالکشن ${this.sourceTable()} — در قطعه‌های ${CHUNK}تایی`,
    );

    const bk = new BuskoolClient(() => job.stopRequested);
    // سیاست خطای رکورد (خواستهٔ مالک ۱۵-۱۱): خطای هر رکورد جاب را
    // نمی‌اندازد — ذخیره و رد می‌شود؛ فقط تکرار پیاپیِ «همین خطا» (یا
    // موج پیاپی خطاهای گوناگون) مشکل سیستمی تلقی می‌شود و جاب را
    // می‌بُرد. سقف‌ها با env قابل تنظیم‌اند.
    const maxRepeatFails = envInt('IMPORTER_MAX_REPEAT_FAILS', 10);
    const maxConsecFails = envInt('IMPORTER_MAX_CONSECUTIVE_FAILS', 15);
    let consecutiveFails = 0; // هر خطایی پیاپی (پشتیبان خطاهای گوناگون)
    let failStreakSig = ''; // امضای خطای متوالی جاری
    let failStreakCount = 0; // چند بار پیاپی همین امضا
    let cursor = offset; // کرسر خواندن منبع
    let consumed = 0; // سندهای خوانده‌شده (شامل ردّشده‌ها) — سقفِ limit
    let chunkNo = 0;

    while (consumed < limit) {
      if (job.stopRequested) throw new Error('JOB_STOPPED');
      await this.waitWhilePaused(job);
      const take = Math.min(CHUNK, limit - consumed);
      const { rows, rawCount } = await this.netRetry(job, () => this.sourceRead(cursor, take));
      if (rawCount === 0) {
        if (consumed === 0) {
          throw new Error(await this.sourceEmptyError(offset, take));
        }
        this.log(job, 'warn', `منبع در ردیف ${cursor} تمام شد — ${consumed.toLocaleString('fa-IR')} کاربر پردازش شد`);
        job.totalUsers = consumed;
        break;
      }
      chunkNo++;
      if (chunkNo > 1) {
        this.log(job, 'info', `قطعهٔ ${chunkNo.toLocaleString('fa-IR')}: ${rows.length} کاربر از ردیف ${cursor.toLocaleString('fa-IR')}`);
      }

      for (const [i, row] of rows.entries()) {
        if (job.stopRequested) throw new Error('JOB_STOPPED');
        await this.waitWhilePaused(job);
        job.currentUserIndex = consumed + i + 1;
        job.currentUser = row.userName;
        // هر کاربر جاب نمایشی خودش را دارد ولی steps مشترک ریست می‌شود
        job.steps.forEach((s) => (s.status = 'pending'));

        // ── ضدتکرار (خواستهٔ مالک): کاربر ایمپورت‌شده — موفق یا ناقص — رد می‌شود ──
        const existing = await this.netRetry(job, () =>
          this.prisma.user.findFirst({
            where: { bUserName: row.userName },
            select: { id: true, failedImport: true, b: true },
          }),
        );
        if (existing) {
          this.bump(job, 'usersSkipped');
          this.log(
            job,
            'warn',
            `↷ ${row.userName} رد شد — ${existing.failedImport ? 'ایمپورت ناقص قبلی (failedImport)' : 'قبلاً ایمپورت شده'}`,
          );
          // بازآوری تصاویر کسب‌وکار (خواستهٔ مالک ۱۴-۱۱): کاربرانِ ایمپورت‌شدهٔ
          // قدیمی عکس‌های مربوطهٔ باسکول را فقط به‌صورت URL خام در b.relateds
          // دارند — بدون تماس جدیدی با باسکول، از همان URLهای آرشیوشده در
          // گالری‌شان rehost می‌شوند؛ idempotent است و در اجرای بعدی رد می‌شود.
          if (!existing.failedImport) {
            const b = asBUserData(existing.b);
            if (b?.relateds?.length) {
              try {
                const { done } = await this.ingestUserRelateds(job, existing.id, b.relateds);
                if (done > 0) {
                  this.log(job, 'success', `  ↳ ${done} تصویر کسب‌وکار باسکول به گالری‌اش اضافه شد`);
                }
              } catch (err) {
                if ((err as Error).message === 'JOB_STOPPED') throw err;
                this.log(job, 'warn', `  ↳ بازآوری تصاویر کسب‌وکار ناموفق: ${(err as Error).message}`);
              }
            }
          }
          continue;
        }

        try {
          await this.netRetry(job, () =>
            this.importOneUser(job, bk, row.userName, row.phone ?? undefined, input.maxProductsPerUser ?? 0),
          );
          job.usersDone = (job.usersDone ?? 0) + 1;
          consecutiveFails = 0;
          failStreakSig = '';
          failStreakCount = 0;
          job.buskoolRequests = bk.requests;
          this.log(
            job,
            'success',
            `✔ ${row.userName} (${(consumed + i + 1).toLocaleString('fa-IR')}/${job.totalUsers.toLocaleString('fa-IR')})`,
          );
        } catch (err) {
          if ((err as Error).message === 'JOB_STOPPED') throw err;
          job.usersFailed = (job.usersFailed ?? 0) + 1;
          const reason = String((err as Error).message ?? err);
          const sig = importErrorSignature(err);
          // خطای این رکورد ذخیره می‌شود و می‌رویم سراغ رکورد بعدی
          // (خواستهٔ مالک ۱۵-۱۱): رکوردِ خراب ≠ جابِ خراب
          this.log(
            job,
            'error',
            `✖ ${row.userName}: ${reason} — برای رسیدگی بعدی ذخیره شد، ادامه با کاربر بعدی`,
          );
          await this.markFailedImport(row.userName, reason, sig).catch(() => undefined);
          consecutiveFails++;
          if (sig === failStreakSig) failStreakCount++;
          else {
            failStreakSig = sig;
            failStreakCount = 1;
          }
          // فقط تکرار پیاپیِ «همین خطا» نشانهٔ مشکل سیستمی است (بلاک شدن
          // باسکول/تغییر API) — قطعی اینترنت اصلاً به اینجا نمی‌رسد
          // (نگهبان شبکه همان‌جا منتظر می‌ماند — net-watch.ts)
          if (failStreakCount >= maxRepeatFails) {
            throw new Error(
              `${failStreakCount.toLocaleString('fa-IR')} شکست پیاپی با خطای یکسان (${sig} — «${reason.slice(0, 140)}») — ` +
                'احتمالاً مشکل سیستمی (بلاک/تغییر API)؛ جاب متوقف شد. خطاها ذخیره شده‌اند؛ ' +
                'پس از رفع مشکل با دکمهٔ «ایمپورت‌نشدهٔ بعدی» ادامه دهید',
            );
          }
          if (consecutiveFails >= maxConsecFails) {
            throw new Error(
              `${consecutiveFails.toLocaleString('fa-IR')} شکست پیاپی با خطاهای گوناگون — ` +
                'احتمالاً مشکل سیستمی؛ جاب متوقف شد. خطاها ذخیره شده‌اند؛ ' +
                'پس از رفع مشکل با دکمهٔ «ایمپورت‌نشدهٔ بعدی» ادامه دهید',
            );
          }
        }
      }

      cursor += rawCount;
      consumed += rawCount;
      job.buskoolRequests = bk.requests;
      // نوار پیشرفت با واقعیت هم‌قدم بماند (آخرین قطعه ممکن است ناقص باشد)
      if (consumed > job.totalUsers) job.totalUsers = consumed;
    }
    this.finishJob(job);
  }

  /** یک کاربر باسکول را کامل ایمپورت می‌کند — خروجی: رکورد User ایمچ.
   *
   * معماری سرعت (خواستهٔ مالک ۱۴-۱۱ — «سریع‌تر، بدون بلاک شدن باسکول»):
   * درخواست‌های مستقل باسکول (آمار، کامنت‌ها، لیست آگهی‌ها، آواتارِ
   * fallback) بلافاصله پس از پروفایل «هم‌زمان» شروع می‌شوند — گیتِ نرخِ
   * BuskoolClient خودش فاصلهٔ ادب و سقف هم‌زمانی را رعایت می‌کند. کارهای
   * دیتابیس در همین حین انجام می‌شوند، جزئیات آگهی‌ها موازی گرفته می‌شوند
   * و همهٔ تصاویر (آواتار + کسب‌وکار + آگهی‌ها) در یک استخر موازی مشترک
   * دانلود/پردازش/ذخیره می‌شوند. نتیجه: همان داده، چند برابر سریع‌تر. */
  private async importOneUser(
    job: JobInternal,
    bk: BuskoolClient,
    userName: string,
    phoneHint: string | undefined,
    maxProducts: number,
  ) {
    // ── ۱. پروفایل ──
    await this.waitWhilePaused(job);
    this.step(job, 'profile', 'active');
    this.log(job, 'info', `دریافت پروفایل @${userName} از باسکول…`);
    const profile: BkProfileResp = await bk.call('/load_profile_by_user_name', { user_name: userName });
    if (!profile?.user_info?.user_name) throw new Error(`کاربر باسکول @${userName} پیدا نشد`);
    const ui = profile.user_info;
    const pf = profile.profile;

    // ── درخواست‌های مستقل هم‌زمان (گیت نرخ فاصله/سقف هم‌زمانی را رعایت می‌کند) ──
    const statsP = guarded(
      bk.call<BkStatsResp>('/get_user_statistics_by_user_name', { user_name: userName }).catch(() => null),
    );
    const commentsP = guarded(
      bk
        .call<BkCommentsResp>('/profile/get-user-comments', { user_id: ui.id })
        .catch(() => null as unknown as BkCommentsResp),
    );
    const itemsP = guarded(this.fetchProductItems(job, bk, userName, maxProducts));
    // آواتار — منبع اصلی فیلد profile_photo همین پاسخ پروفایل است؛ اندپوینت
    // عکس تأییدشده فقط fallback است و فقط وقتی لازم است صدا زده می‌شود.
    const avatarFallbackP = guarded(
      (pf?.profile_photo ?? '').trim()
        ? Promise.resolve(null)
        : bk.call<BkAvatarResp>('/get_user_last_confirmed_profile_photo', { user_id: ui.id }).catch(() => null),
    );

    // ── کارهای دیتابیس در حین پرواز درخواست‌های باسکول ──

    // شماره موبایل: دستی > جدول منبع > ساختگی از bUserId
    const phone =
      phoneHint ??
      (await this.sourcePhoneFor(userName)) ??
      (await this.uniqueFakePhone(ui.id, userName));

    // مکان از نام‌ها (اگر آگهی باشد، در مرحلهٔ بعد با id دقیق اصلاح می‌شود)
    // — از کش (۱۵-۱۱): در جاب لیستی، findFirst های تکراری حذف می‌شود
    const provinceLoc = ui.province ? await this.findLocationCached('province', ui.province) : null;
    const cityLoc =
      ui.city && provinceLoc
        ? await this.findLocationCached('city', ui.city, provinceLoc.id)
        : null;

    // «درباره کسب‌وکار» (خواستهٔ مالک ۱۳-۱۱): متنِ خودِ کاربر به ستون
    // businessDesc می‌رود — همان جایی که فرم ویرایش پروفایل آیمچ می‌نویسد
    // (users/updateProfile) و کاتالوگ عمومی می‌خواند (getSeller)؛ متن
    // خودکار باسکول/اینکوباک (کاربر چیزی ننوشته) رد می‌شود تا صفحه، متن
    // پارامتریک آیمچ را نشان دهد (lib/seller-text در فرانت). در متن خودِ
    // کاربر هم نام باسکول/اینکوباک با آیمچ جایگزین می‌شود (خواستهٔ مالک).
    const descAuto = isBuskoolAutoDesc(pf?.description);
    const descClean = aimchifyBrandMentions((pf?.description ?? '').trim());
    const businessDesc = descAuto ? null : descClean || null;

    // ── سند رفتار باسکول (خواستهٔ مالک ۱۳-۱۱) ──
    // ویژه بودن باسکول فقط اینجا ثبت می‌شود — هرگز به activePakageType
    // آیمچ کپی نمی‌شود؛ کاربر در آیمچ رایگان می‌ماند تا خودش با پرداخت
    // واقعی ویژه شود (بعداً با تماس/تخفیف دعوتش می‌کنیم).
    // در ایمپورت مجدد، مهرهای CRM (contactedAt) و تاریخ اولین ایمپورت
    // (importedAt) از سند قبلی حفظ می‌شوند.
    const prevDoc = await this.prisma.user.findFirst({
      where: { userName },
      select: { b: true },
    });
    const prevB = asBUserData(prevDoc?.b);

    // آمار باسکول — از همان ابتدای جاب موازی در پرواز بود، الان آماده است
    const statsResp = await statsP;
    const st = statsResp?.statistics?.user_info;

    const bkPackageType = st?.active_package_type ?? ui.active_pakage_type ?? 0;
    const bkPremium = bkPackageType > 0;
    const relatedUrls = (profile.relateds ?? [])
      .map((r) => (typeof r === 'string' ? r.trim() : (r?.name ?? '').trim()))
      .filter(Boolean);
    const bData: BUserData = {
      source: 'buskool',
      userName,
      userId: ui.id,
      profileId: pf?.id ?? null,
      premium: {
        isPremium: bkPremium,
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
      // متن خودکار ارزش آرشیوی ندارد و برای هر کاربر جدا ذخیره نمی‌شود
      // (خواستهٔ مالک ۱۳-۱۱) — فقط فلگ descriptionIsAuto می‌ماند.
      descriptionRaw: descAuto ? null : (pf?.description ?? '').trim() || null,
      descriptionIsAuto: descAuto,
      responseRate: st?.response_rate ?? null,
      reputationScore: st?.reputation_score ?? null,
      productsCount: st?.products_count ?? null,
      ratingCount: statsResp?.statistics?.rating_info?.total_count ?? null,
      ratingAvg: statsResp?.statistics?.rating_info?.avg_rating_score ?? null,
      ibp: profile.ibp === true,
      createdAt: this.bkDate(ui.created_at)?.toISOString() ?? null,
      importedAt: prevB?.importedAt ?? new Date().toISOString(),
      contactedAt: prevB?.contactedAt ?? null,
    };

    // فیلدهای نمایشی پروفایل با «همان کلیدهای استاندارد» فرم ویرایش پروفایل
    // آیمچ (profile embedded: address/isCompany/companyName/activityDomain)
    // ذخیره می‌شوند تا کاتالوگ عمومی، دفتر خرید و فرم ویرایش، دادهٔ باسکول
    // را «در جای خودش» ببینند؛ داده‌های مختص باسکول همه در b است.
    const profileJson = {
      address: pf?.address ?? null,
      isCompany: pf?.is_company === 1 || Boolean((pf?.company_name ?? '').trim()),
      companyName: (pf?.company_name ?? '').trim(),
      activityDomain: profile.activity_domain ?? pf?.activity_domain ?? null,
    };

    const user = await this.prisma.user.upsert({
      where: { userName },
      update: {
        firstName: ui.first_name ?? '',
        lastName: ui.last_name ?? '',
        sex: ui.sex ?? null,
        isVerified: ui.is_verified === 1,
        isBuyer: ui.is_buyer === 1,
        isSeller: ui.is_seller === 1 || true,
        // ⚠️ activePakageType عمداً دست نمی‌خورد — ویژه شدن باسکول فقط در
        // b.premium ثبت می‌شود؛ در آیمچ فقط پرداخت واقعی کاربر را ویژه می‌کند
        provinceId: provinceLoc?.buskolId ?? null,
        cityId: cityLoc?.buskolId ?? null,
        profile: profileJson as object,
        // سند رفتار باسکول — همهٔ فیلدهای ارزشمند در یک JSON (خواستهٔ مالک)
        b: bData as object,
        // دربارهٔ کسب‌وکار در جای خودش (خواستهٔ مالک ۱۳-۱۱) — همان ستونی که
        // کاتالوگ عمومی و فرم ویرایش می‌خوانند
        businessDesc,
        // ضدتکرار ایمپورت لیستی (خواستهٔ مالک ۱۳-۱۱) — موفقیت پرچم شکست را برمی‌دارد
        bUserName: userName,
        failedImport: false,
      },
      create: {
        phone,
        userName,
        firstName: ui.first_name ?? '',
        lastName: ui.last_name ?? '',
        sex: ui.sex ?? null,
        role: 'USER',
        isVerified: ui.is_verified === 1,
        isBuyer: ui.is_buyer === 1,
        isSeller: true,
        provinceId: provinceLoc?.buskolId ?? null,
        cityId: cityLoc?.buskolId ?? null,
        profile: profileJson as object,
        b: bData as object,
        businessDesc,
        bUserName: userName,
        createdAt: this.bkDate(ui.created_at) ?? new Date(),
      },
    });
    this.step(job, 'profile', 'done');
    if (bkPremium) {
      this.log(
        job,
        'info',
        `در باسکول ویژه بوده (بستهٔ ${bData.premium.packageTitle}) — فقط در داده‌های باسکولی ثبت شد؛ در آیمچ رایگان می‌ماند تا خودش پرداخت کند`,
      );
    }
    this.log(
      job,
      'info',
      businessDesc
        ? `دربارهٔ کسب‌وکار در جای خودش (توضیحات کسب و کار) ثبت شد${
            descClean !== (pf?.description ?? '').trim() ? ' — اشاره به باسکول/اینکوباک با «آیمچ» جایگزین شد' : ''
          }`
        : 'متن «درباره کسب‌وکار» خالی/خودکارِ باسکول بود — ثبت نشد (صفحه متن پیش‌فرض آیمچ را نشان می‌دهد)',
    );
    this.log(
      job,
      'success',
      `کاربر ${ui.first_name} ${ui.last_name} (@${userName}) ثبت شد — ایمچ #${user.id.slice(-6)} • باسکول #${ui.id}`,
    );

    // ── ۲. آواتار — تعیین منبع (دانلود/ذخیره در استخر مشترک تصاویر، مرحلهٔ ۵) ──
    // منبع اصلی (خواستهٔ مالک ۱۳-۱۱): فیلد profile_photo در پاسخ
    // load_profile_by_user_name — همان درخواستی که برای پروفایل زده‌ایم و
    // کوکی باسکول رویش هست (نمونهٔ پاسخ: URL مستقیم profile-photos آروان).
    // اندپوینت جداگانهٔ get_user_last_confirmed_profile_photo فقط fallback
    // است — برای کاربرانی که عکسشان هنوز «تأییدشده» نیست خالی برمی‌گردد و
    // همین باعث می‌شد آواتار برخی کاربران رد شود.
    this.step(job, 'avatar', 'active');
    let avUrl: string | null = (pf?.profile_photo ?? '').trim() || null;
    if (!avUrl) {
      const av = await avatarFallbackP;
      avUrl =
        typeof av?.profile_photo === 'string'
          ? av.profile_photo
          : ((av?.profile_photo as { file_path?: string; url?: string } | null)?.file_path ??
            (av?.profile_photo as { url?: string } | null)?.url ??
            null);
    }
    if (!avUrl) {
      this.step(job, 'avatar', 'skipped');
      this.log(job, 'info', 'آواتاری روی باسکول ثبت نشده است');
    }

    // (تصاویر کسب‌وکار relateds — خواستهٔ مالک ۱۴-۱۱ — همراه آواتار و عکس‌های
    //  آگهی‌ها، همه در استخر موازی مشترکِ مرحلهٔ ۵ پردازش می‌شوند؛ سقف همان
    //  MAX_RELATEDS_PER_USER و idempotent با metadata.originalUrl)

    // ── ۳. آگهی‌ها — لیست از ابتدای جاب موازی در حال دریافت بوده؛ الان آماده است ──
    this.step(job, 'products', 'active');
    const items = await itemsP;
    this.bump(job, 'productsTotal', items.length);
    this.log(job, 'info', `${items.length} آگهی عمومی از باسکول دریافت شد`);

    const catById = await this.getCatById();

    let maxProductId = 0;
    for (const item of items) maxProductId = Math.max(maxProductId, item.main.id);

    // ── ثبت لیستی (خواستهٔ مالک ۱۵-۱۱: «کلا لیستی‌ها رو این کارو انجام بده») ──
    // جدیدها = یک createMany برای همه؛ موجودها = آپدیت دستهٔ موازی. قبلاً:
    // upsert تک‌تکی (۱ رفت‌وبرگشت Atlas به‌ازای هر آگهی) — کاربر ۵۰ آگهی‌ای
    // ≈ ۵۰ رفت‌وبرگشت؛ حالا ایمپورت اول ≈ ۳ رفت‌وبرگشت برای همه.
    const existingProdIds = new Set(
      (
        await this.prisma.product.findMany({
          where: { id: { in: items.map((it) => it.main.id) } },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    // آماده‌سازی موازی (ساخت دستهٔ غایب هم همین‌جا — رقابت با catch حل می‌شود)
    const prepared = await Promise.all(
      items.map(async (it) => ({
        ...(await this.buildProductData(job, it.main, user.id, catById)),
        isNew: !existingProdIds.has(it.main.id),
      })),
    );
    const toCreateProducts = prepared.filter((p) => p.isNew).map((p) => p.create);
    const toUpdateProducts = prepared.filter((p) => !p.isNew);
    if (toCreateProducts.length) {
      if (job.stopRequested) throw new Error('JOB_STOPPED');
      await this.prisma.product.createMany({ data: toCreateProducts });
    }
    for (let c = 0; c < toUpdateProducts.length; c += DB_CHUNK) {
      if (job.stopRequested) throw new Error('JOB_STOPPED');
      const chunk = toUpdateProducts.slice(c, c + DB_CHUNK);
      await Promise.all(
        chunk.map((p) => this.prisma.product.update({ where: { id: p.id }, data: p.update })),
      );
    }
    this.bump(job, 'products', items.length);
    // اصلاح مکان کاربر با اولین آگهی (اگر از نام‌ها پیدا نشده بود)
    if (items.length && (!provinceLoc || !cityLoc) && items[0].main.province_id) {
      await this.prisma.user
        .update({
          where: { id: user.id },
          data: {
            provinceId: provinceLoc?.buskolId ?? items[0].main.province_id,
            cityId: cityLoc?.buskolId ?? items[0].main.city_id,
          },
        })
        .catch(() => undefined);
    }
    this.step(job, 'products', 'done');
    this.log(job, 'success', `${items.length} آگهی در دیتابیس ثبت/بروزرسانی شد`);

    // Counter محصول باید از idهای باسکول جلوتر بماند (الگوی seed)
    if (maxProductId > 0) {
      const cur = await this.prisma.counter.findUnique({ where: { id: 'product' } });
      const next = Math.max(cur?.seq ?? 0, maxProductId + 1000);
      await this.prisma.counter.upsert({
        where: { id: 'product' },
        update: { seq: next },
        create: { id: 'product', seq: next },
      });
    }

    // ── ۴. کامنت‌ها (قبل از تصاویر — پاسخ باسکول از ابتدای جاب آماده بوده و
    //    ثبت DB سبک است؛ اگر وسط تصاویر جاب متوقف شود، این داده از قبل ثبت شده است) ──
    await this.waitWhilePaused(job);
    // (خواستهٔ مالک ۱۳-۱۱) نویسندگان کامنت‌های باسکول کاربر واقعی ایمچ نیستند —
    // دیگر برایشان User با شمارهٔ موبایل ساختگی ساخته نمی‌شود (اشغال شمارهٔ
    // واقعی + پر شدن جدول کاربران از کاربران الکی). نام/شهرشان در جدول
    // user_for_b_comment و خود کامنت در b_comment می‌نشیند؛ نمایش در
    // getSellerReviews: اول کامنت‌های واقعی، بعد این‌ها. پاک‌سازی ۲-۳ سال
    // بعد = deleteMany همین دو جدول، بدون دست‌زدن به جدول کاربران.
    this.step(job, 'reviews', 'active');
    const comments = await commentsP;
    const list = (comments?.comments ?? []).filter((c) => c.rating_score || c.text);
    if (job.stopRequested) throw new Error('JOB_STOPPED');
    {
      // ── ثبت لیستی (خواستهٔ مالک ۱۵-۱۱: «کامنتها رو لیستی بگیر و لیستی اینزرت کن») ──
      // قبلاً: به‌ازای هر کامنت ۲+ رفت‌وبرگشت به Atlas (findFirst نویسنده + upsert)
      // = کاربرِ ۱۶۰ کامنتی ≈ ۳۲۰ رفت‌وبرگشت ≈ ده‌ها ثانیه. حالا ۳-۴ کوئری
      // برای همه: findMany نویسنده‌ها ← createMany غایب‌ها (id سمت کلاینت) ←
      // findMany کامنت‌های موجود ← createMany جدیدها + آپدیت فقط تغییرکرده‌ها.
      if (list.length) {
        // جدیدترین کامنتِ هر نویسنده ملاک است (تکراری‌های احتمالی باسکول)
        const byAuthor = new Map<string, BkCommentsResp['comments'][number]>();
        for (const c of list) {
          const key = c.user_id ? `u${c.user_id}` : `c${c.c_id}`;
          const prev = byAuthor.get(key);
          if (!prev || (c.created_at ?? '') >= (prev.created_at ?? '')) byAuthor.set(key, c);
        }
        const uniq = [...byAuthor.values()];

        // ۱) نویسنده‌های موجود — یک کوئری
        const bkIds = uniq.filter((c) => c.user_id).map((c) => c.user_id as number);
        const cIds = uniq.filter((c) => !c.user_id).map((c) => c.c_id);
        const existingAuthors = await this.prisma.userForBComment.findMany({
          where: {
            OR: [
              ...(bkIds.length ? [{ bUserId: { in: bkIds } }] : []),
              ...(cIds.length ? [{ bCommentId: { in: cIds } }] : []),
            ],
          },
          select: { id: true, bUserId: true, bCommentId: true },
        });
        const authorIdByKey = new Map<string, string>();
        for (const a of existingAuthors) {
          if (a.bUserId != null) authorIdByKey.set(`u${a.bUserId}`, a.id);
          if (a.bCommentId != null) authorIdByKey.set(`c${a.bCommentId}`, a.id);
        }

        // ۲) نویسنده‌های غایب — یک createMany با id ساخته‌شده سمت کلاینت
        const missing = uniq.filter((c) => !authorIdByKey.has(c.user_id ? `u${c.user_id}` : `c${c.c_id}`));
        if (missing.length) {
          await this.prisma.userForBComment.createMany({
            data: missing.map((c) => {
              const id = newObjectId();
              authorIdByKey.set(c.user_id ? `u${c.user_id}` : `c${c.c_id}`, id);
              return {
                id,
                bUserId: c.user_id ?? null,
                bCommentId: c.c_id ?? null,
                firstName: c.first_name ?? '',
                lastName: c.last_name ?? '',
                // شهر نویسنده از خود باسکول — زیر کامنت نمایش داده می‌شود
                city: (c.city ?? '').trim() || null,
              };
            }),
          });
          this.bump(job, 'bCommentAuthors', missing.length);
        }

        // ۳) کامنت‌های موجود این فروشنده — یک کوئری
        const allAuthorIds = [...authorIdByKey.values()];
        const existingComments = allAuthorIds.length
          ? await this.prisma.bComment.findMany({
              where: { sellerId: user.id, authorId: { in: allAuthorIds } },
              select: { authorId: true, rating: true, text: true, createdAt: true },
            })
          : [];
        const existingByAuthor = new Map(existingComments.map((r) => [r.authorId, r]));

        // ۴) جدیدها یک‌جا + آپدیت فقط تغییرکرده‌ها
        const toCreate: Prisma.BCommentCreateManyInput[] = [];
        const toUpdate: { authorId: string; rating: number; text?: string; createdAt: Date }[] = [];
        for (const c of uniq) {
          const authorId = authorIdByKey.get(c.user_id ? `u${c.user_id}` : `c${c.c_id}`)!;
          const rating = c.rating_score ?? 5;
          const createdAt = this.bkDate(c.created_at) ?? new Date();
          const text = c.text ? aimchifyBrandMentions(c.text.slice(0, 1000)) : '';
          const prev = existingByAuthor.get(authorId);
          if (!prev) {
            toCreate.push({ sellerId: user.id, authorId, rating, text, createdAt });
          } else {
            // متن خالیِ پاسخ جدید (کوکی منقضی/کامنت فقط-امتیازی) متنِ قبلی را
            // پاک نمی‌کند — فقط متنِ واقعی جایگزین می‌شود
            const textChanged = !!text && text !== prev.text;
            if (prev.rating !== rating || textChanged || prev.createdAt.getTime() !== createdAt.getTime()) {
              toUpdate.push({
                authorId,
                rating,
                ...(textChanged ? { text } : {}),
                createdAt,
              });
            }
          }
        }
        if (toCreate.length) await this.prisma.bComment.createMany({ data: toCreate });
        // آپدیت‌ها مستقل‌اند — دستهٔ کوچک موازی
        for (let i = 0; i < toUpdate.length; i += DB_CHUNK) {
          if (job.stopRequested) throw new Error('JOB_STOPPED');
          const chunk = toUpdate.slice(i, i + DB_CHUNK);
          await Promise.all(
            chunk.map((u) =>
              this.prisma.bComment.update({
                where: { authorId_sellerId: { authorId: u.authorId, sellerId: user.id } },
                data: { rating: u.rating, ...(u.text ? { text: u.text } : {}), createdAt: u.createdAt },
              }),
            ),
          );
        }
        this.bump(job, 'reviews', toCreate.length + toUpdate.length);
      }
    }
    this.step(job, 'reviews', 'done');
    {
      const empty = list.filter((c) => !c.text).length;
      if (empty > 0 && !buskoolConfig().cookie) {
        this.log(job, 'warn', `${empty} کامنت بدون متن است — با BUSKOOL_COOKIE متن کامل گرفته می‌شود`);
      } else if (empty > 0) {
        // کوکی هست ولی باز متن خالی آمد — علت را دقیق بگوییم (کشف ۱۵-۱۱:
        // کوکیِ مهمان از سمت باسکول پذیرفته می‌شود ولی چیزی باز نمی‌کند)
        const loggedIn = await buskoolSessionLoggedIn();
        const why =
          loggedIn === false
            ? 'کوکی لاگین نیست (سشن مهمان) — بعد از ورود به حساب در buskool.com کوکی تازه بگیرید'
            : loggedIn === true
              ? 'سشن لاگین است ولی باسکول متن این کامنت‌ها را نمی‌دهد (فقط-امتیازی یا منتظر تأیید)'
              : 'سشن منقضی/بی‌اثر است یا شبکه خطا داد';
        this.log(
          job,
          'warn',
          `${empty} کامنت بدون متن آمد با اینکه BUSKOOL_COOKIE تنظیم است — ${why} (متن‌های قبلی حفظ شدند)`,
        );
      }
    }
    this.log(job, 'success', `${list.length} کامنت در جدول b_comment ثبت شد (لیستی، بدون ساخت کاربر)`);

    // ── ۵. تصاویر — آواتار + کسب‌وکار + عکس‌های آگهی‌ها، یک استخر موازی مشترک ──
    await this.waitWhilePaused(job);
    this.step(job, 'relateds', 'active');
    this.step(job, 'images', 'active');

    // ۵.الف) تصاویر کسب‌وکار (خواستهٔ مالک ۱۴-۱۱): عکس‌های «مربوطهٔ» پروفایل
    // باسکول همان تصاویر کسب‌وکار کاربرند — به اسلات استاندارد گالری کاربر
    // rehost می‌شوند تا کاتالوگ عمومی (/c/…) آنها را نشان دهد؛ idempotent با
    // metadata.originalUrl
    const relatedCapped = relatedUrls.slice(0, MAX_RELATEDS_PER_USER);
    const relatedExisting = await this.prisma.file.findMany({
      where: { relatedModel: 'User', relatedId: user.id, fieldKey: 'gallery' },
      select: { metadata: true },
    });
    const relatedSeen = new Set(
      relatedExisting
        .map((f) => (f.metadata as { originalUrl?: string } | null)?.originalUrl)
        .filter((u): u is string => Boolean(u)),
    );
    const relatedTodo = relatedCapped.filter((u) => !relatedSeen.has(u));
    const relatedAlready = relatedCapped.length - relatedTodo.length;
    if (relatedCapped.length) {
      this.log(job, 'info', `تصاویر کسب‌وکار باسکول (${relatedCapped.length} مورد)…`);
    } else {
      this.step(job, 'relateds', 'skipped');
      this.log(job, 'info', 'تصویر کسب‌وکاری روی باسکول ثبت نشده است');
    }

    // ۵.ب) آگهی‌های بدون عکسِ قبلاً ذخیره‌شده — یک کوئری برای همه (قبلاً یکی‌یکی)
    const pidStrs = items.map((it) => String(it.main.id));
    const doneFiles = pidStrs.length
      ? await this.prisma.file.findMany({
          where: { relatedModel: 'Product', fieldKey: 'gallery', relatedId: { in: pidStrs } },
          select: { relatedId: true },
        })
      : [];
    const pidsDone = new Set(doneFiles.map((f) => f.relatedId));
    const needDetails = items.filter((it) => !pidsDone.has(String(it.main.id)));

    // ۵.ج) جزئیات آگهی‌ها موازی — گیت نرخ خودش فاصلهٔ ادب را رعایت می‌کند
    const detailResps = await Promise.all(
      needDetails.map((it) =>
        bk.call<BkProductDetailResp>('/get_product_by_id', { product_id: it.main.id }).catch(() => null),
      ),
    );
    const photosByPid = new Map<number, string[]>();
    needDetails.forEach((it, idx) => {
      const photos = (detailResps[idx]?.product?.photos ?? [])
        .map((p) => p.file_path)
        .filter(Boolean)
        .slice(0, MAX_PHOTOS_PER_PRODUCT);
      if (photos.length) {
        photosByPid.set(it.main.id, photos);
        this.log(job, 'info', `عکس‌های آگهی #${it.main.id} (${photos.length} مورد)…`);
      }
    });

    // ۵.د) استخر موازی مشترک: دانلود → نرمال‌سازی → همان مسیر/پردازش آپلود عادی
    type ImgTask =
      | { kind: 'avatar'; url: string }
      | { kind: 'related'; url: string; i: number }
      | { kind: 'product'; pid: number; url: string; i: number };
    const imgTasks: ImgTask[] = [];
    if (avUrl) imgTasks.push({ kind: 'avatar', url: avUrl });
    relatedTodo.forEach((url, i) => imgTasks.push({ kind: 'related', url, i }));
    for (const [pid, urls] of photosByPid) urls.forEach((url, i) => imgTasks.push({ kind: 'product', pid, url, i }));

    let relatedDone = 0;
    let wmCleanedUser = 0; // واترمارک‌های پاک‌شدهٔ همین کاربر (۲۰-۱۱)
    const imgWorker = async (t: ImgTask): Promise<void> => {
      if (job.stopRequested) throw new Error('JOB_STOPPED');
      await this.waitWhilePaused(job);
      const img = await fetchImage(t.url, () => job.stopRequested);
      const norm = img ? await normalizeImage(img.buf, img.mime) : null;
      if (!norm) {
        if (t.kind === 'avatar') {
          this.step(job, 'avatar', 'done');
          this.log(job, 'warn', 'دانلود/پردازش آواتار ناموفق بود — رد شد');
        } else if (t.kind === 'related') {
          this.bump(job, 'relatedsFailed');
        } else {
          this.bump(job, 'imagesFailed');
        }
        return;
      }
      // (۲۰-۱۱) پاک‌سازی واترمارک در لحظهٔ ایمپورت — فقط تصاویر گالری آگهی؛
      // آواتار/تصاویر کسب‌وکار مالیت آگهی ندارند و دست نمی‌خورند
      let uploadBuf = norm.buf;
      let uploadMime = norm.mime;
      let wmOutcome: 'removed' | 'not_found' | 'failed' | undefined;
      if (t.kind === 'product') {
        const wm = await cleanBuskoolWatermark(norm.buf);
        wmOutcome = wm.status;
        if (wm.status === 'removed') {
          uploadBuf = wm.buf;
          uploadMime = wm.mimetype ?? norm.mime;
          wmCleanedUser++;
          this.bump(job, 'wmCleaned');
        }
      }
      try {
        if (t.kind === 'avatar') {
          // همان مسیر/پردازش آپلود عادی پروفایل: users/{userId}/avatars/avatar/…
          // (خواستهٔ مالک ۱۳-۱۱) — انگار که کاربر خودش عکس پروفایل را گذاشته
          const res = await this.netRetry(job, () =>
            this.uploads.ingestExternal({
              ownerId: user.id,
              model: 'User',
              modelId: user.id,
              fieldKey: 'avatar',
              buffer: norm.buf,
              mimetype: norm.mime,
              filename: t.url.split('/').pop() || `buskool-avatar-${userName}`,
              replace: true, // اسلات تک‌فایلی — عین پنل کاربر
              metadata: { importedFrom: 'buskool', originalUrl: t.url },
            }),
          );
          if (res.ok) {
            await this.prisma.user.update({ where: { id: user.id }, data: { avatarUrl: res.file.url } });
            this.step(job, 'avatar', 'done');
            this.log(job, 'success', 'آواتار دانلود و در پوشهٔ خود کاربر ذخیره شد');
          } else {
            // ردشدن گیرایی نیست — کاربر بدون آواتار ادامه می‌یابد (حرف اول نام)
            this.step(job, 'avatar', 'done');
            this.log(job, 'warn', `آواتار رد شد (${res.reason})`);
          }
        } else if (t.kind === 'related') {
          // همان مسیر/پردازش آپلود عادی تصاویر کسب‌وکار:
          // users/{userId}/avatars/gallery/… با تامبنیل و بدون واترمارک
          const res = await this.netRetry(job, () =>
            this.uploads.ingestExternal({
              ownerId: user.id,
              model: 'User',
              modelId: user.id,
              fieldKey: 'gallery',
              buffer: norm.buf,
              mimetype: norm.mime,
              filename: t.url.split('/').pop() || `buskool-related-${t.i + 1}`,
              replace: false, // گالری چندفایلی
              metadata: { importedFrom: 'buskool', originalUrl: t.url },
            }),
          );
          if (res.ok) {
            relatedDone++;
            this.bump(job, 'relatedsDownloaded');
          } else {
            this.bump(job, 'relatedsFailed');
            this.log(job, 'warn', `تصویر کسب‌وکار ${t.i + 1} رد شد (${res.reason})`);
          }
        } else {
          // همان مسیر/پردازش آگهی معمولی (خواستهٔ مالک ۱۳-۱۱):
          // users/{userId}/products/{pid}/gallery/… — از ۲۰-۱۱ واترمارک باسکول
          // همین لحظه پاک می‌شود و نسخهٔ تمیز بالا می‌رود («انگار که آگهی
          // توسط کاربر ایجاد شده»)؛ ردیف File با storageKey کامل.
          const res = await this.netRetry(job, () =>
            this.uploads.ingestExternal({
              ownerId: user.id,
              model: 'Product',
              modelId: String(t.pid),
              fieldKey: 'gallery',
              buffer: uploadBuf,
              mimetype: uploadMime,
              filename: t.url.split('/').pop() || `buskool-${t.pid}-${t.i}`,
              replace: false, // گالری چندفایلی
              metadata: { importedFrom: 'buskool', originalUrl: t.url },
              watermarkOutcome: wmOutcome,
            }),
          );
          if (res.ok) {
            this.bump(job, 'imagesDownloaded');
          } else {
            this.bump(job, 'imagesFailed');
            this.log(job, 'warn', `عکس ${t.pid}/${t.i} رد شد (${res.reason})`);
          }
        }
      } catch (err) {
        if ((err as Error).message === 'JOB_STOPPED') throw err;
        if (t.kind === 'avatar') {
          this.step(job, 'avatar', 'done');
          this.log(job, 'warn', `آواتار رد شد: ${(err as Error).message}`);
        } else if (t.kind === 'related') {
          this.bump(job, 'relatedsFailed');
          this.log(job, 'warn', `تصویر کسب‌وکار ${t.i + 1} ناموفق: ${(err as Error).message}`);
        } else {
          this.bump(job, 'imagesFailed');
          this.log(job, 'warn', `عکس ${t.pid}/${t.i} ناموفق: ${(err as Error).message}`);
        }
      }
    };

    if (imgTasks.length) {
      await runPool(imgTasks, imagePoolSize(), () => job.stopRequested, imgWorker);
    }

    // گزارش پاک‌سازی واترمارک همین کاربر (۲۰-۱۱)
    if (wmCleanedUser > 0) {
      this.log(job, 'success', `واترمارک باسکول از ${wmCleanedUser} تصویر این کاربر پاک شد`);
    }

    // جمع‌بندی مراحل تصویری
    if (relatedCapped.length) {
      this.step(job, 'relateds', 'done');
      if (relatedDone > 0) {
        this.log(
          job,
          'success',
          `${relatedDone} تصویر کسب‌وکار در گالری کاربر ذخیره شد${relatedAlready ? ` (${relatedAlready} مورد قبلاً بود)` : ''}`,
        );
      } else if (relatedAlready > 0) {
        this.log(job, 'info', 'تصاویر کسب‌وکار قبلاً ذخیره شده‌اند — رد شد');
      } else {
        this.log(job, 'warn', 'هیچ‌کدام از تصاویر کسب‌وکار دانلود/پذیرش نشد');
      }
    }
    this.step(job, 'images', 'done');

    return user;
  }

  /**
   * تصاویر کسب‌وکار باسکول (relateds) → اسلات استاندارد گالری کاربر
   * (File: relatedModel=User, fieldKey=gallery) — همان‌جایی که فرم ویرایش
   * پروفایل می‌نویسد و کاتالوگ عمومی (getSeller → /c/…) می‌خواند.
   *
   * idempotent: هر URL فقط یک‌بار rehost می‌شود — ردیف‌های موجود گالری از
   * روی metadata.originalUrl چک می‌شوند؛ در ایمپورت مجدد و بازآوری
   * کاربران قدیمی چیزی دوبله نمی‌شود. سقف: MAX_RELATEDS_PER_USER (۸) —
   * همان سقف گالری پنل، تا نتیجه عین گالری چیده‌شده توسط خود کاربر باشد.
   * خطای هر عکس مستقل است و بقیه را نمی‌اندازد (شمارندهٔ relatedsFailed).
   */
  private async ingestUserRelateds(
    job: JobInternal,
    userId: string,
    urls: string[],
  ): Promise<{ done: number; already: number }> {
    const capped = urls.filter(Boolean).slice(0, MAX_RELATEDS_PER_USER);
    if (!capped.length) return { done: 0, already: 0 };

    // URLهای قبلاً rehost‌شده — از metadata ردیف‌های موجود گالری کاربر
    const existingRows = await this.prisma.file.findMany({
      where: { relatedModel: 'User', relatedId: userId, fieldKey: 'gallery' },
      select: { metadata: true },
    });
    const seen = new Set(
      existingRows
        .map((f) => (f.metadata as { originalUrl?: string } | null)?.originalUrl)
        .filter((u): u is string => Boolean(u)),
    );
    const todo = capped.map((url, i) => ({ url, i })).filter((t) => !seen.has(t.url));
    if (!todo.length) return { done: 0, already: capped.length };

    let done = 0;
    await runPool(todo, imagePoolSize(), () => job.stopRequested, async (t) => {
      await this.waitWhilePaused(job);
      const img = await fetchImage(t.url, () => job.stopRequested);
      const norm = img ? await normalizeImage(img.buf, img.mime) : null;
      if (!norm) {
        this.bump(job, 'relatedsFailed');
        return;
      }
      try {
        // همان مسیر/پردازش آپلود عادی تصاویر کسب‌وکار:
        // users/{userId}/avatars/gallery/… با تامبنیل و بدون واترمارک
        const res = await this.netRetry(job, () =>
          this.uploads.ingestExternal({
            ownerId: userId,
            model: 'User',
            modelId: userId,
            fieldKey: 'gallery',
            buffer: norm.buf,
            mimetype: norm.mime,
            filename: t.url.split('/').pop() || `buskool-related-${t.i + 1}`,
            replace: false, // گالری چندفایلی
            metadata: { importedFrom: 'buskool', originalUrl: t.url },
          }),
        );
        if (res.ok) {
          done++;
          this.bump(job, 'relatedsDownloaded');
        } else {
          this.bump(job, 'relatedsFailed');
          this.log(job, 'warn', `تصویر کسب‌وکار ${t.i + 1} رد شد (${res.reason})`);
        }
      } catch (err) {
        if ((err as Error).message === 'JOB_STOPPED') throw err;
        this.bump(job, 'relatedsFailed');
        this.log(job, 'warn', `تصویر کسب‌وکار ${t.i + 1} ناموفق: ${(err as Error).message}`);
      }
    });
    return { done, already: capped.length - todo.length };
  }

  /** لیست صفحه‌بندی‌شدهٔ آگهی‌های عمومی باسکول — صفحات ترتیبی‌اند (شمارهٔ
   *  رکورد ادامهٔ صفحهٔ قبل است) ولی خودِ این حلقه از ابتدای جاب موازی با
   *  بقیهٔ درخواست‌های کاربر در پرواز است. */
  private async fetchProductItems(
    job: JobInternal,
    bk: BuskoolClient,
    userName: string,
    maxProducts: number,
  ): Promise<BkProductItem[]> {
    const items: BkProductItem[] = [];
    for (let from = 0; ; from += PAGE) {
      await this.waitWhilePaused(job);
      const resp: BkProductListResp = await bk.call('/get_product_list_by_user_name', {
        user_name: userName,
        status: 2,
        is_public: true,
        from_record_number: from,
        to_record_number: from + PAGE,
      });
      const batch = (resp?.products ?? []).filter((p) => p?.main && !p.main.is_rejected && !p.main.deleted_at);
      items.push(...batch);
      if (maxProducts > 0 && items.length >= maxProducts) {
        items.length = maxProducts;
        break;
      }
      if (batch.length < PAGE) break;
      if (job.stopRequested) throw new Error('JOB_STOPPED');
    }
    return items;
  }

  /** دادهٔ ساخت/آپدیت یک آگهی باسکول — خروجی دو شیء آماده برای createMany/
   *  update (ثبت لیستی ۱۵-۱۱؛ الگوی scripts/seed-products.mjs) */
  private async buildProductData(
    job: JobInternal,
    m: BkProductItem['main'],
    userId: string,
    catById: Map<number, { parentId: number | null }>,
  ): Promise<{
    id: number;
    create: Prisma.ProductCreateManyInput;
    update: Prisma.ProductUpdateInput;
  }> {
    // دسته پدر: اگر برگ زیر یک دستهٔ میانی است، پدر درستش را بگیر
    let categoryId = m.category_id;
    const sub = catById.get(m.sub_category_id);
    if (sub && sub.parentId != null) categoryId = sub.parentId;

    // اگر دستهٔ باسکول در پایگاه ما نیست، زنجیره را بساز (تاجای ریشه)
    if (!catById.has(m.sub_category_id)) {
      await this.ensureCategory(m.sub_category_id, m.sub_category_name, m.category_id, catById);
      await this.ensureCategory(m.category_id, m.category_name, null, catById);
      categoryId = m.category_id;
      this.log(job, 'warn', `دستهٔ «${m.sub_category_name}» نبود — ساخته شد`);
    }

    const name = (m.product_name ?? '').trim();
    // مهرهای زمانی دقیق باسکول (خواستهٔ مالک ۱۳-۱۱): ثبت/آپدیت/آپدیت قیمت
    // عیناً همان باسکول می‌مانند — «۲ دقیقه پیش» روی آگهی چندسالهٔ قدیمی،
    // یعنی قیمت تازه است و خریدار گمراه می‌شود.
    // زنجیرهٔ fallback (۱۵-۱۱): مهر غایب هرگز به «لحظهٔ ایمپورت» نمی‌افتد —
    // چون سورت لیست‌ها با همین مهرهاست، آگهی قدیمی با مهر تازهٔ جعلی بالای
    // «جدیدترین» می‌نشیند. قیمت غایب ← updated_at باسکول؛ آپدیت غایب ←
    // آپدیت قیمت ← ثبت باسکول.
    const bkUpdated = this.bkDate(m.updated_at);
    const priceUpdatedAt = this.bkDate(m.last_price_update) ?? bkUpdated;
    const updatedAt = bkUpdated ?? priceUpdatedAt ?? this.bkDate(m.p_created_at) ?? new Date();
    const description = aimchifyBrandMentions(descToText(m.description));
    return {
      id: m.id,
      // آپدیت موجود‌ها — همان فیلدهای قبلی upsert
      update: {
        productName: name,
        // <hr/> جداکنندهٔ خطوط باسکول → خط نو (خواستهٔ مالک ۱۴-۱۱)
        description,
        // مهر غایب = مقدار موجود حفظ می‌شود (null ننویس — کارت به مهر قدیمی
        // تکیه می‌کند)
        ...(priceUpdatedAt ? { priceUpdatedAt } : {}),
        // پنجرهٔ اعتبار ۳روزه برای آگهی باسکولی بی‌معناست — قیمتش ماه‌ها/سال‌ها
        // قدیمی است و بج «قیمت منقضی شده» پنل بلافاصله می‌افتاد؛ کهنگی عمومی
        // با متن قرمز «بیش از یک ماه آپدیت نشده» در صفحهٔ آگهی گفته می‌شود.
        // با اولین ویرایش واقعی فروشنده، پنجرهٔ انتخابی خودش فعال می‌شود.
        priceValidityDays: 3650,
        categoryId,
        subCategoryId: m.sub_category_id,
        unit: m.unit || 'کیلوگرم',
        provinceId: m.province_id,
        cityId: m.city_id,
        stock: m.stock ?? 0,
        minSaleAmount: m.min_sale_amount ?? 0,
        minSalePrice: m.min_sale_price ?? 0,
        isElevated: m.is_elevated === 1,
        hasVideo: !!m.has_video,
        status: 'confirmed',
        updatedAt,
      },
      // ساخت جدیدها — همان فیلدها + id/slug/userId/مهر ثبت
      create: {
        id: m.id,
        productName: name,
        slug: `فروش-عمده-${name}-${m.id}`,
        description,
        priceUpdatedAt: priceUpdatedAt ?? updatedAt,
        priceValidityDays: 3650,
        categoryId,
        subCategoryId: m.sub_category_id,
        unit: m.unit || 'کیلوگرم',
        provinceId: m.province_id,
        cityId: m.city_id,
        stock: m.stock ?? 0,
        minSaleAmount: m.min_sale_amount ?? 0,
        minSalePrice: m.min_sale_price ?? 0,
        isElevated: m.is_elevated === 1,
        hasVideo: !!m.has_video,
        status: 'confirmed',
        userId,
        createdAt: this.bkDate(m.p_created_at) ?? new Date(),
        updatedAt: this.bkDate(m.updated_at) ?? new Date(),
      },
    };
  }

  /** دسته‌ها با کش — یک findMany در عمر پروسه؛ ensureCategory نقشه را تازه
   *  نگه می‌دارد و cleanup باطلش می‌کند */
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

  /** استان/شهر با کش — جدول locations تغییرناپذیر است؛ نتیجه (حتی null) کش
   *  می‌شود تا جاب لیستی برای هر کاربر ۲ findFirst نزند */
  private async findLocationCached(
    type: 'province' | 'city',
    name: string,
    parentId?: string,
  ): Promise<{ id: string; buskolId: number | null } | null> {
    const key = `${type}:${name}:${parentId ?? ''}`;
    if (this.locCache.has(key)) return this.locCache.get(key) ?? null;
    const row = await this.prisma.location.findFirst({
      where: { type, name, ...(parentId ? { parentId } : {}) },
      select: { id: true, buskolId: true },
    });
    this.locCache.set(key, row);
    return row;
  }

  /** ساخت زنجیرهٔ دستهٔ غایب (id عددی باسکول) */
  private async ensureCategory(
    id: number,
    name: string,
    parentId: number | null,
    catById: Map<number, { parentId: number | null }>,
  ) {
    if (!id || catById.has(id)) return;
    const slug = `cat-${id}`;
    await this.prisma.category
      .create({ data: { id, parentId, categoryName: name || `دسته ${id}`, slug } })
      .catch(() => undefined); // رقابت — قبلاً ساخته شده
    catById.set(id, { parentId });
  }

  /**
   * نشانه‌گذاری شکست ایمپورت (خواستهٔ مالک ۱۳-۱۱) — کاربر (حتی ناقص) با پرچم
   * failedImport می‌ماند تا بعداً رسیدگی شود؛ ایمپورت‌های بعدی هم از او رد
   * می‌شوند تا دادهٔ تکراری نسازد.
   */
  private async markFailedImport(userName: string, reason?: string, sig?: string) {
    // دلیل شکست روی خود رکورد ذخیره می‌شود (خواستهٔ مالک ۱۵-۱۱: «جایی
    // ذخیره کن که بعداً رسیدگی کنیم») — صفحهٔ «کاربران ایمپورت‌شده» با
    // فیلتر «ناقص/شکست‌خورده» نشانش می‌دهد
    const errDoc = reason
      ? {
          message: reason.slice(0, 600),
          sig: sig ?? importErrorSignature(reason),
          at: new Date().toISOString(),
        }
      : null;
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ bUserName: userName }, { userName }] },
      select: { id: true, profile: true },
    });
    if (existing) {
      await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          failedImport: true,
          bUserName: userName,
          ...(errDoc
            ? { profile: { ...((existing.profile ?? {}) as object), bImportError: errDoc } as object }
            : {}),
        },
      });
      return;
    }
    // پروفایل باسکول اصلاً نیامده — stub حداقلی با شمارهٔ ساختگی یکتا
    for (let i = 0; i < 3; i++) {
      const suffix = i === 0 ? '' : `-${Math.random().toString(36).slice(2, 6)}`;
      const stubName = `bk-f-${userName}`.slice(0, 56) + suffix;
      try {
        const phone = await this.uniqueFakePhone(0, stubName);
        await this.prisma.user.create({
          data: {
            phone,
            userName: stubName,
            role: 'USER',
            isSeller: false,
            isBuyer: false,
            bUserName: userName,
            failedImport: true,
            profile: {
              bStub: true,
              importedFrom: 'buskool-failed',
              importedAt: new Date().toISOString(),
              ...(errDoc ? { bImportError: errDoc } : {}),
            } as object,
          },
        });
        return;
      } catch {
        /* userName تکراری — پسوند تصادفی بعدی */
      }
    }
  }

  /** شمارهٔ ساختگی یکتا — پیشوند «08» + رقم (خواستهٔ مالک ۱۳-۱۱): هیچ شمارهٔ
   *  موبایل واقعی ایرانی (۰۹…) را اشغال نمی‌کند. فقط برای stub های
   *  failedImport (نشانگر «ایمپورت شکست‌خورده») استفاده می‌شود — نویسندگان
   *  کامنت باسکول دیگر اصلاً User نمی‌شوند (جدول user_for_b_comment). */
  private async uniqueFakePhone(bkId: number, userName: string): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const candidate = `08${String(100000000 + ((bkId + i * 7919) % 900000000)).slice(-9)}`;
      const owner = await this.prisma.user.findUnique({ where: { phone: candidate }, select: { userName: true } });
      if (!owner || owner.userName === userName) return candidate;
    }
    return `08${String(Date.now()).slice(-9)}`;
  }

  /** تاریخ باسکول «2026-09-27 14:29:20» → Date (UTC) */
  private bkDate(s: string | null | undefined): Date | null {
    if (!s) return null;
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ─── درایور ذخیره‌سازی — فقط برای پاک‌سازی بایت‌ها (delete/urlToKey/deletePrefix)؛
  // ذخیرهٔ عکس‌های ایمپورت از طریق UploadsService (همان درایور آپلود عادی) می‌گذرد

  private storeInstance?: Awaited<ReturnType<typeof buildStorage>>;
  private get store() {
    if (!this.storeInstance) this.storeInstance = buildStorage();
    return this.storeInstance;
  }

  // ═══════════════════════════ پاک‌سازی ═══════════════════════════

  /** پاک‌سازی کامل برای شروع مهاجرت — فقط حساب ادمین می‌ماند */
  async cleanup(adminPhone: string) {
    this.assertAdmin(adminPhone);
    // کش‌های ایمپورتر با دیتای پاک‌شده بی‌اعتبار می‌شوند (۱۵-۱۱)
    this.catCache = null;
    this.locCache.clear();
    const counts: Record<string, number | string> = {};
    const wipe = async (key: string, fn: () => Promise<{ count: number }>) => {
      counts[key] = (await fn()).count;
    };
    const admin = await this.prisma.user.findUnique({ where: { phone: adminPhone } });

    // داده‌های وابسته (هر چیزی که به User غیرادمین اشاره دارد یا دادهٔ بازار است)
    // ⚠️ ترتیب حیاتی است: Prisma روی MongoDB روابط را شبیه‌سازی می‌کند و رابطهٔ
    //    الزامیِ بدون Cascade (LadderOrder→Product، ChatThread→User،
    //    CallLog→User، SellerReview→User و…) والد را تا وقتی فرزند دارد حذف
    //    نمی‌کند (خطای P2014). پس همهٔ فرزندان قبل از والد پاک می‌شوند:
    //    ۱) فرزندان Product → ۲) خود Product → ۳) فرزندان User → ۴) خود User.
    await wipe('ladderOrders', () => this.prisma.ladderOrder.deleteMany({})); // → Product (الزامی)
    await wipe('chatMessages', () => this.prisma.chatMessage.deleteMany({})); // → ChatThread
    await wipe('chats', () => this.prisma.chatThread.deleteMany({})); // → Product/User
    await wipe('callLogs', () => this.prisma.callLog.deleteMany({})); // → Product/User
    await wipe('reviews', () => this.prisma.sellerReview.deleteMany({})); // → User
    await wipe('bComments', () => this.prisma.bComment.deleteMany({})); // → User/UserForBComment
    await wipe('bCommentAuthors', () => this.prisma.userForBComment.deleteMany({}));
    await wipe('products', () => this.prisma.product.deleteMany({}));
    await wipe('files', () => this.prisma.file.deleteMany({}));
    await wipe('buyRequests', () => this.prisma.buyRequest.deleteMany({}));
    await wipe('contacts', () => this.prisma.contact.deleteMany({}));
    await wipe('followNotes', () => this.prisma.followNote.deleteMany({})); // → FollowItem
    await wipe('followItems', () => this.prisma.followItem.deleteMany({})); // → FollowFolder
    await wipe('followFolders', () => this.prisma.followFolder.deleteMany({}));
    await wipe('favorites', () => this.prisma.favoriteProduct.deleteMany({}));
    await wipe('favoriteSellers', () => this.prisma.favoriteSeller.deleteMany({}));
    await wipe('productViews', () => this.prisma.productView.deleteMany({}));
    await wipe('productEditHistory', () => this.prisma.productEditHistory.deleteMany({}));
    await wipe('supplyOffers', () => this.prisma.supplyOffer.deleteMany({}));
    await wipe('serviceSignups', () => this.prisma.serviceSignup.deleteMany({}));
    await wipe('buyerCategories', () => this.prisma.buyerCategory.deleteMany({}));
    await wipe('savedCatalogs', () => this.prisma.savedCatalog.deleteMany({})); // → UserCatalog
    await wipe('userCatalogs', () => this.prisma.userCatalog.deleteMany({}));
    await wipe('savedBuyerBooks', () => this.prisma.savedBuyerBook.deleteMany({})); // → UserBuyerBook
    await wipe('userBuyerBooks', () => this.prisma.userBuyerBook.deleteMany({}));
    await wipe('verificationOrders', () => this.prisma.verificationOrder.deleteMany({}));
    await wipe('chargeOrders', () => this.prisma.chargeOrder.deleteMany({}));
    await wipe('packageOrders', () => this.prisma.packageOrder.deleteMany({}));
    await wipe('walletAdjustments', () => this.prisma.walletAdjustment.deleteMany({}));
    await wipe('feedbackUpvotes', () => this.prisma.feedbackUpvote.deleteMany({})); // → FeedbackItem
    await wipe('feedbackItems', () => this.prisma.feedbackItem.deleteMany({}));
    await wipe('adminMessages', () => this.prisma.adminMessage.deleteMany({}));
    await wipe('supportMessages', () => this.prisma.supportMessage.deleteMany({}));
    await wipe('pushSubscriptions', () => this.prisma.pushSubscription.deleteMany({}));
    await wipe('activityLogs', () => this.prisma.activityLog.deleteMany({}));
    await wipe('otpCodes', () => this.prisma.otpCode.deleteMany({}));
    await wipe('refreshTokens', () => this.prisma.refreshToken.deleteMany({}));
    await wipe('counters', () => this.prisma.counter.deleteMany({}));

    // کاربران — همه به‌جز ادمین
    counts.users = admin
      ? (await this.prisma.user.deleteMany({ where: { id: { not: admin.id } } })).count
      : (await this.prisma.user.deleteMany({})).count;

    // ── بایت‌های ذخیره‌سازی (آروان/لوکال) — عکس‌های ایمپورت اکنون در همان
    // مسیر آپلود عادی (users/{id}/…) می‌نشینند؛ پاک‌سازی کامل باید بایت‌هایشان
    // را هم بهترین‌حال بردارد تا آبجکت یتیم نماند. ردیف‌های قدیمی ایمپورتر که
    // storageKey=null دارند، کلیدشان از url استخراج می‌شود (urlToKey).
    // الگوی removeAllForModel: حذف غیرمسدودکننده — ردیف‌ها همین‌جا می‌روند و
    // آبجکت‌ها در پس‌زمینه پاک می‌شوند تا درخواست ادمین روی شبکهٔ لرزان معلق نماند.
    try {
      const fileRows = await this.prisma.file.findMany({
        select: { storageKey: true, thumbStorageKey: true, url: true },
      });
      const keys = new Set<string>();
      for (const f of fileRows) {
        if (f.storageKey) keys.add(f.storageKey);
        if (f.thumbStorageKey) keys.add(f.thumbStorageKey);
        const derived = this.store.urlToKey(f.url);
        if (derived) {
          keys.add(derived);
          keys.add(`${derived}.thumb.jpg`);
        }
      }
      for (const k of keys) void this.store.delete(k).catch(() => undefined);
      counts.storageObjectsQueued = keys.size;
    } catch {
      /* بهترین‌حال — حذف ردیف‌های DB منبع حقیقت است */
    }

    // پوشهٔ قدیمی buskool/ (ایمپورت‌های پیش از ۱۳-۱۱) — دیگر استفاده نمی‌شود؛
    // آبجکت‌های جامانده در آروان/دیسک یک‌جا جمع می‌شوند.
    try {
      counts.legacyBuskoolObjects = await this.store.deletePrefix('buskool/');
    } catch (err) {
      counts.legacyBuskoolObjects = `خطا: ${(err as Error).message}`;
    }
    counts.adminPhone = adminPhone;
    return counts;
  }

  // ═══════════════════════════ پیش‌نمایش ═══════════════════════════

  /** خواندن دادهٔ ایمپورت‌شدهٔ یک کاربر از دیتابیس ایمچ (قرارداد فرانت) */
  async preview(userName: string) {
    const user = await this.prisma.user.findUnique({ where: { userName } });
    if (!user) throw new ForbiddenException(`کاربر @${userName} در دیتابیس ایمچ نیست — اول ایمپورت کنید`);

    const [products, reviews, bComments, bCommentsTotal, buyRequests, photoRows] = await Promise.all([
      this.prisma.product.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      this.prisma.sellerReview.findMany({
        where: { sellerId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { author: true },
      }),
      // کامنت‌های باسکولی همین فروشنده — نویسندهٔ ساختگی user_for_b_comment
      this.prisma.bComment.findMany({
        where: { sellerId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { author: true },
      }),
      this.prisma.bComment.count({ where: { sellerId: user.id } }),
      this.prisma.buyRequest.count({ where: { userId: user.id } }),
      this.prisma.file.findMany({
        where: { relatedModel: 'Product', fieldKey: 'gallery' },
        select: { relatedId: true, url: true },
      }),
    ]);

    const productIds = new Set(products.map((p) => String(p.id)));
    const photosByProduct = new Map<string, string[]>();
    for (const f of photoRows) {
      if (!productIds.has(f.relatedId ?? '')) continue;
      const arr = photosByProduct.get(f.relatedId ?? '') ?? [];
      arr.push(f.url);
      photosByProduct.set(f.relatedId ?? '', arr);
    }

    // نام دسته/استان برای نمایش
    const catIds = [...new Set(products.map((p) => p.subCategoryId))];
    const provIds = [...new Set(products.map((p) => p.provinceId).filter((x): x is number => x != null))];
    const [cats, provs] = await Promise.all([
      this.prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, categoryName: true } }),
      this.prisma.location.findMany({
        where: { type: 'province', buskolId: { in: provIds } },
        select: { buskolId: true, name: true },
      }),
    ]);
    const catName = new Map(cats.map((c) => [c.id, c.categoryName]));
    const provName = new Map(provs.map((p) => [p.buskolId, p.name]));

    const pj = (user.profile ?? {}) as Record<string, unknown>;
    const b = asBUserData(user.b);
    const avatarUrl = user.avatarUrl;

    return {
      user: {
        id: user.id,
        phone: user.phone,
        userName: user.userName,
        firstName: user.firstName,
        lastName: user.lastName,
        isVerified: user.isVerified,
        isSeller: user.isSeller,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        // داده‌های باسکول از سند b؛ fallback رکوردهای قدیمی (پیش از b)
        bUserId: b?.userId ?? ((pj.bUserId as number) ?? null),
        bActivePackageType: b?.premium.packageType ?? user.activePakageType,
        bPremium: b ? b.premium : null,
        bResponseRate: b?.responseRate ?? ((pj.bResponseRate as number) ?? null),
        bReputationScore: b?.reputationScore ?? ((pj.bReputationScore as string) ?? null),
        bActivityDomain: b?.activityDomain ?? ((pj.activityDomain as string) ?? null),
        bBuskoolCreatedAt: b?.createdAt ?? null,
      },
      profile: user.profile
        ? {
            // کلیدهای استاندارد آیمچ (جدید) + fallback به رکوردهای قدیمی
            // تستر که با پیشوند b_* ذخیره شده بودند
            address: (pj.address as string) ?? (pj.bAddress as string) ?? null,
            companyName: (pj.companyName as string) ?? (pj.bCompanyName as string) ?? '',
            description: user.businessDesc ?? ((pj.bDescription as string) ?? null),
            confirmed: b?.confirmed ?? ((pj.bConfirmed as boolean) ?? false),
            bRelateds: b?.relateds ?? ((pj.bRelateds as string[]) ?? []),
          }
        : null,
      avatar: {
        url: avatarUrl && avatarUrl.startsWith('http') ? avatarUrl : null,
        localUrl: avatarUrl && !avatarUrl.startsWith('http') ? avatarUrl : null,
      },
      counts: {
        products: await this.prisma.product.count({ where: { userId: user.id } }),
        photos: photoRows.filter((f) => productIds.has(f.relatedId ?? '')).length,
        reviews: (await this.prisma.sellerReview.count({ where: { sellerId: user.id } })) + bCommentsTotal,
        buyRequests,
      },
      products: products.map((p) => ({
        id: p.id,
        bProductId: p.id,
        name: p.productName,
        price: p.minSalePrice || null,
        stock: p.stock,
        unit: p.unit,
        category: catName.get(p.subCategoryId) ?? null,
        province: p.provinceId ? (provName.get(p.provinceId) ?? null) : null,
        city: null,
        createdAt: p.createdAt.toISOString(),
        photos: (photosByProduct.get(String(p.id)) ?? []).map((url) => ({
          url: url.startsWith('http') ? url : null,
          localUrl: url.startsWith('http') ? null : url,
        })),
      })),
      // کامنت‌های واقعی اول، بعد کامنت‌های باسکولی — همان ترتیب صفحهٔ عمومی
      reviews: [
        ...reviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.text,
          createdAt: r.createdAt.toISOString(),
          reviewer: {
            firstName: r.author.firstName,
            lastName: r.author.lastName,
            city: null,
            isStub: !!((r.author.profile ?? {}) as Record<string, unknown>)?.bStub,
          },
        })),
        ...bComments.map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.text,
          createdAt: r.createdAt.toISOString(),
          reviewer: {
            firstName: r.author.firstName,
            lastName: r.author.lastName,
            city: r.author.city,
            isStub: true, // نویسندهٔ باسکولی — کاربر ایمچ نیست
          },
        })),
      ],
    };
  }
}

// ─── تصویر: دانلود امن + نرمال‌سازی فرمت (پردازش/ذخیره عین سرویس uploads) ────

/** نرمال‌سازی فارسی برای مقایسهٔ متن — نیم‌فاصله → فاصله، ی/ک عربی → فارسی، فاصله‌های تکراری یکی */
function normalizeFa(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/\u200c/g, ' ')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * تشخیص متن خودکار «دربارهٔ کسب‌وکار» باسکول — دو نسل قالب دارد:
 *
 * نسل اینکوباک (نام قدیمی سایت — گزارش مالک ۱۳-۱۱؛ ۳ مورد از ۴ مورد در
 * دیتای فعلی همین شکل است):
 * «من فروشنده محصولات کشاورزی در سامانه ی اینکوباک هستم. برای ارتباط با
 *  من رو دکمه ی ارسال پیام کلیک کنید. خوشحال می شوم اگر پروفایل من را
 *  با دوستان خود به اشتراک بگذارید.»
 *
 * نسل باسکول (نمونهٔ مالک ۱۳-۱۱):
 * «بشیر قربانی هستم از شهر مریوان در حال خرید و فروش عمده در بازار بزرگ
 *  باسکول. برای ارتباط با من روی دکمه ی ارسال پیام بزنید. خوشحال می شوم
 *  پروفایل من را با همکارانتان به اشتراک بگذارید.»
 *
 * اسکلت مشترک: جملهٔ «برای ارتباط با من رو[ی] دکمه …» + «… به اشتراک
 * بگذارید.» + اشاره به برند (باسکول/اینکوباک، با ی/ک عربی هم). این متن
 * محصول خودِ کاربر نیست → در businessDesc نمی‌نشیند تا صفحهٔ آیمچ متن
 * پارامتریک خودش (lib/seller-text فرانت) را نشان دهد (خواستهٔ مالک).
 */
export function isBuskoolAutoDesc(desc: string | null | undefined): boolean {
  if (!desc) return false;
  const t = normalizeFa(desc);
  const contact = t.includes('برای ارتباط با من رو') && t.includes('به اشتراک بگذارید');
  const brand =
    /در حال خرید و فروش عمده در بازار بزرگ (باسکول|اینکوباک)/.test(t) ||
    /در سامانه ?ی? ?(باسکول|اینکوباک) هستم/.test(t) ||
    /در (وب ?سایت|سایت) (باسکول|اینکوباک)/.test(t);
  return contact && brand;
}

/**
 * جایگزینی نام برندهای قدیمی با «آیمچ» در متن‌های «خودِ کاربر» (خواستهٔ
 * مالک ۱۳-۱۱: «کلا اگر در توضیحات کلمه باسکول دیدی با آیمچ جایگزین کن»):
 * «باسکول» و نام قدیمی‌اش «اینکوباک». ک/ك عربی هم پوشیده داده می‌شود.
 * فقط همین دو واژه — بقیهٔ متن دست نمی‌خورد.
 */
export function aimchifyBrandMentions(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/باس[كک]ول/g, 'آیمچ')
    .replace(/این[كک]وبا[كک]/g, 'آیمچ');
}

// ─── ابزارهای هم‌زمانی ──────────────────────────────────────────────────────

/** promise معلق را در برابر «unhandled rejection» امن می‌کند — در فاز موازی
 *  ممکن است خطای مسیر دیگر (مثلاً DB) زودتر پرتاب شود و این درخواست‌ها هرگز
 *  await نشوند؛ گارد، کرشِ پروسهٔ serverless را غیرممکن می‌کند. */
function guarded<T>(p: Promise<T>): Promise<T> {
  p.catch(() => undefined);
  return p;
}

/** استخر کارگر موازی — N کارگر وظیفه‌ها را از یک صف مشترک برمی‌دارند.
 *  خطای هر وظیفه مستقل است (درون worker مدیریت می‌شود)؛ فقط JOB_STOPPED
 *  کل استخر را می‌اندازد. */
export async function runPool<T>(
  tasks: T[],
  concurrency: number,
  stop: () => boolean,
  worker: (task: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const size = Math.max(1, Math.min(concurrency, tasks.length));
  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      if (stop()) throw new Error('JOB_STOPPED');
      const i = next++;
      if (i >= tasks.length) return;
      try {
        await worker(tasks[i]);
      } catch (err) {
        if ((err as Error)?.message === 'JOB_STOPPED') throw err;
        // خطای مستقلِ این وظیفه — بقیهٔ صف ادامه می‌دهند؛ لاگ/شمارندهٔ خطا
        // وظیفهٔ خود worker است (مثل imgWorker که هر عکس را جدا مدیریت می‌کند)
      }
    }
  });
  await Promise.all(runners);
}

/** هم‌زمانی دانلود/پردازش تصاویر (sharp + آپلود ابر) — پیش‌فرض ۴ */
export function imagePoolSize(): number {
  const raw = Number(process.env.IMPORTER_IMAGE_CONCURRENCY ?? 4);
  const n = Number.isFinite(raw) ? Math.floor(raw) : 4;
  return Math.min(Math.max(n, 1), 8);
}

/** ObjectId سازگار با Mongo — ۱۲ بایت تصادفی hex؛ برای createMany سطرهایی که
 *  بعداً باید idشان را بدانیم (نویسندگان کامنت) — Prisma در createMany idهای
 *  ساخته‌شده را برنمی‌گرداند، پس خودمان می‌سازیم (همان طرح auto()). */
function newObjectId(): string {
  return randomBytes(12).toString('hex');
}

/** دانلود تصویر — مقاوم در برابر قطعی اینترنت (۱۵-۱۱ شب):
 *  خطای شبکه‌ای (DNS/سوکت/تایم‌اوت) عکس را «ردشده» نمی‌کند؛ تا برگشتن شبکه
 *  همان عکس نگه داشته می‌شود و بعد ادامه می‌یابد. فقط ردّهای محتوایی
 *  (فایل خراب/mime غیرواقعی/بیش از ۸MB) پس از دو تلاش عکس را می‌اندازند. */
export async function fetchImage(
  rawUrl: string,
  stop?: () => boolean,
): Promise<{ buf: Buffer; mime: string } | null> {
  let contentFails = 0; // ردّهای محتوایی — دو تلاش و رد شدن
  let firstNetErrAt = 0; // پنجرهٔ «آنلاین-ولی-CDN-جواب-نمی‌دهد» (۱۰ دقیقه)
  for (;;) {
    let r: { buf: Buffer; mime: string } | null;
    try {
      r = await fetchImageOnce(rawUrl);
    } catch (err) {
      // قطع شبکه — مثل API باسکول بایست تا وصل شود و همان عکس ادامه یابد
      if (!firstNetErrAt) firstNetErrAt = Date.now();
      else if (Date.now() - firstNetErrAt > 10 * 60_000) return null;
      await waitForOnline(stop);
      await sleep(800);
      continue;
    }
    if (r) return r;
    contentFails++;
    if (contentFails >= 2) return null; // مشکل خود فایل — دو تلاش کافی
    await sleep(700);
  }
}

async function fetchImageOnce(rawUrl: string): Promise<{ buf: Buffer; mime: string } | null> {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || /^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)) return null;
    let res: Response;
    try {
      res = await fetch(u.toString(), {
        signal: AbortSignal.timeout(20_000),
        // هدرهای مرورگرگونه — CDN آروان با آن‌ها پایدارتر پاسخ می‌دهد
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          referer: 'https://www.buskool.com/',
        },
        redirect: 'follow',
      });
    } catch (err) {
      // خطای شبکه‌ای را از ردّهای محتوایی جدا کن — نگهبان شبکه باید ببیندش
      if (isNetworkError(err)) throw err;
      return null;
    }
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('image/') && !mime.startsWith('binary/') && !mime.startsWith('application/octet-stream')) {
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 8 * 1024 * 1024) return null;
    // امضای واقعی تصویر؟ (CDN باسکول گاهی octet-stream می‌فرستد) — mime از
    // بایت‌ها، نه از هدر؛ UploadsService همان پردازش آپلود عادی را اجرا می‌کند.
    if (buf[0] === 0xff && buf[1] === 0xd8) return { buf, mime: 'image/jpeg' };
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e) return { buf, mime: 'image/png' };
    if (buf.slice(8, 12).toString('ascii') === 'WEBP') return { buf, mime: 'image/webp' };
    if (buf.slice(0, 3).toString('ascii') === 'GIF') return { buf, mime: 'image/gif' };
    return null;
  } catch {
    return null;
  }
}

/**
 * نرمال‌سازی برای فیلتر ALLOWED_MIME آپلود عادی — فقط GIF پیش‌تبدیل می‌شود
 * (فریم اول → PNG)؛ jpeg/png/webp عیناً پاس می‌شوند تا «همان» پردازش کاربر
 * (پاین‌لاین ۱۲۰۰px/سقف ۵۰۰KB + واترمارک آگهی) رویشان اجرا شود.
 */
export async function normalizeImage(buf: Buffer, mime: string): Promise<{ buf: Buffer; mime: string } | null> {
  if (mime !== 'image/gif') return { buf, mime };
  try {
    return { buf: await sharp(buf).png().toBuffer(), mime: 'image/png' };
  } catch {
    return null; // تصویر خراب — رد می‌شود
  }
}
