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
 *   • عکس‌ها دانلود → پاین‌لاین sharp (۱۶۰۰/۴۰۰) → StorageDriver اپ
 *     (local: دیسک uploads، arvan: باکت CDN) → ردیف File با fieldKey=gallery.
 *   • نویسنده‌های کامنت «کاربر کمکی» (stub) می‌شوند — با ایمپورت واقعی بعدی
 *     همان bUserId ادغام می‌شوند.
 *   • همهٔ درخواست‌های باسکول از صف BuskoolClient با فاصلهٔ BUSKOOL_DELAY_MS.
 */
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { buildStorage } from '../uploads/storage';
import sharp from 'sharp';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { storage } from '../common/config/env';
import {
  BuskoolClient,
  buskoolConfig,
  type BkAvatarResp,
  type BkCommentsResp,
  type BkProductDetailResp,
  type BkProductItem,
  type BkProductListResp,
  type BkProfileResp,
  type BkStatsResp,
} from './buskool.client';
import { importerAdminPhone } from './dto';

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
}

interface JobInternal extends ImportJob {
  stopRequested: boolean;
  buskoolRequests: number;
}

const STEP_DEFS: { key: string; label: string }[] = [
  { key: 'profile', label: 'پروفایل و ساخت کاربر' },
  { key: 'avatar', label: 'آواتار' },
  { key: 'products', label: 'آگهی‌ها' },
  { key: 'images', label: 'تصاویر آگهی‌ها' },
  { key: 'reviews', label: 'کامنت‌ها' },
];

const MAX_JOBS = 50;
const PAGE = 20; // اندازهٔ صفحهٔ لیست آگهی‌های باسکول
const MAX_PHOTOS_PER_PRODUCT = 4;

@Injectable()
export class ImporterService {
  private readonly logger = new Logger(ImporterService.name);
  private readonly jobs = new Map<string, JobInternal>();

  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════ وضعیت ‌و آمار ═══════════════════════════

  ping() {
    const { delayMs, cookie } = buskoolConfig();
    return {
      ok: true,
      delayMs,
      busy: [...this.jobs.values()].some((j) => j.status === 'running'),
      cookieSet: cookie.length > 0,
      adminPhone: importerAdminPhone(),
      // درایور ذخیرهٔ عکس‌ها — فرانت نشان می‌دهد تا «چرا عکس‌ها لوکال نیست» همیشه معلوم باشد
      storageDriver: storage.DRIVER,
    };
  }

  async stats() {
    const [users, products, photos, reviews, buyRequests, chats, savedUsers, serviceInterests] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.product.count(),
        this.prisma.file.count(),
        this.prisma.sellerReview.count(),
        this.prisma.buyRequest.count(),
        this.prisma.chatThread.count(),
        this.prisma.followItem.count(),
        this.prisma.serviceSignup.count(),
      ]);
    return { users, products, photos, reviews, buyRequests, chats, savedUsers, serviceInterests };
  }

  /**
   * دیتابیس منبع — کالکشن user-buskool در «همان دیتابیس» ایمچ (خواستهٔ مالک
   * ۱۳-۱۱: جدول را خودش با دامپ کاربران باسکول ساخته؛ دیگر دیتابیس جانبی
   * لازم نیست). خواندن با $runCommandRaw تا شکل سندهای دامپ (فیلدهای اضافی)
   * مهم نباشد و فقط user_name/phone خوانده شود.
   */
  private sourceTable() {
    return process.env.IMPORT_SOURCE_TABLE?.trim() || 'user-buskool';
  }

  /** فیلدهای یوزرنیم/تلفن کالکشن منبع — مطابق دامپ باسکول */
  private sourceFields() {
    return {
      userName: process.env.IMPORT_SOURCE_USERNAME_COLUMN?.trim() || 'user_name',
      phone: process.env.IMPORT_SOURCE_PHONE_COLUMN?.trim() || 'phone',
    };
  }

  /** خواندن دسته‌ای از کالکشن منبع، مرتب بر اساس یوزرنیم */
  private async sourceRead(offset: number, limit: number): Promise<{ userName: string; phone: string | null }[]> {
    const { userName: uf, phone: pf } = this.sourceFields();
    const res = (await this.prisma.$runCommandRaw({
      find: this.sourceTable(),
      sort: { [uf]: 1 },
      skip: offset,
      limit,
      batchSize: limit,
      projection: { [uf]: 1, [pf]: 1 },
    })) as unknown as { cursor?: { firstBatch?: Record<string, unknown>[] } };
    return (res?.cursor?.firstBatch ?? [])
      .map((d) => {
        const userName = String(d[uf] ?? '').trim();
        const rawPhone = d[pf] == null ? '' : String(d[pf]).replace(/[^0-9]/g, '');
        return { userName, phone: /^09\d{9}$/.test(rawPhone) ? rawPhone : null };
      })
      .filter((r) => r.userName.length > 0);
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
      const [sample, imported, failed] = await Promise.all([
        this.sourceRead(0, 5),
        this.prisma.user.count({ where: { bUserName: { not: null } } }),
        this.prisma.user.count({ where: { failedImport: true } }),
      ]);
      return {
        connected: true,
        table,
        phoneColumn: this.sourceFields().phone,
        userNameColumn: this.sourceFields().userName,
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
    let scanned = 0;
    while (scanned < total) {
      const rows = await this.sourceRead(scanned, 5000);
      if (!rows.length) break;
      for (const [i, r] of rows.entries()) {
        if (imported.has(r.userName)) continue;
        remaining++;
        if (!first) first = { offset: scanned + i, userName: r.userName };
      }
      scanned += rows.length;
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
      const { userName: uf, phone: pf } = this.sourceFields();
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
    return this.jobs.get(id) ?? null;
  }

  stopJob(id: string, adminPhone: string): { stopped: boolean } {
    this.assertAdmin(adminPhone);
    const job = this.jobs.get(id);
    if (!job || job.status !== 'running') return { stopped: false };
    job.stopRequested = true;
    this.log(job, 'info', 'درخواست توقف ثبت شد — بین درخواست‌های بعدی متوقف می‌شود');
    return { stopped: true };
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
    job.finishedAt = Date.now();
    job.counters['buskoolRequests'] = job.buskoolRequests;
    this.log(job, 'success', 'ایمپورت کامل شد ✓');
  }

  // ═══════════════════════════ اجرا ═══════════════════════════

  private async runSingle(job: JobInternal, input: { userName: string; phone?: string; maxProducts?: number }) {
    const bk = new BuskoolClient(() => job.stopRequested);
    const user = await this.importOneUser(job, bk, input.userName, input.phone, input.maxProducts ?? 0);
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
    const rows = await this.sourceRead(offset, limit);
    if (!rows.length) {
      throw new Error(`ردیفی در کالکشن ${this.sourceTable()} از offset=${offset} نبود — شاید به انتهای لیست رسیده‌اید`);
    }

    job.totalUsers = rows.length;
    job.usersDone = 0;
    job.usersFailed = 0;
    this.log(job, 'info', `${rows.length} کاربر از ردیف ${offset} کالکشن ${this.sourceTable()} خوانده شد`);

    const bk = new BuskoolClient(() => job.stopRequested);
    let consecutiveFails = 0;
    for (const [i, row] of rows.entries()) {
      if (job.stopRequested) throw new Error('JOB_STOPPED');
      job.currentUserIndex = i + 1;
      job.currentUser = row.userName;
      // هر کاربر جاب نمایشی خودش را دارد ولی steps مشترک ریست می‌شود
      job.steps.forEach((s) => (s.status = 'pending'));

      // ── ضدتکرار (خواستهٔ مالک): کاربر ایمپورت‌شده — موفق یا ناقص — رد می‌شود ──
      const existing = await this.prisma.user.findFirst({
        where: { bUserName: row.userName },
        select: { failedImport: true },
      });
      if (existing) {
        this.bump(job, 'usersSkipped');
        this.log(
          job,
          'warn',
          `↷ ${row.userName} رد شد — ${existing.failedImport ? 'ایمپورت ناقص قبلی (failedImport)' : 'قبلاً ایمپورت شده'}`,
        );
        continue;
      }

      try {
        await this.importOneUser(job, bk, row.userName, row.phone ?? undefined, input.maxProductsPerUser ?? 0);
        job.usersDone = (job.usersDone ?? 0) + 1;
        consecutiveFails = 0;
        job.buskoolRequests = bk.requests;
        this.log(job, 'success', `✔ ${row.userName} (${i + 1}/${rows.length})`);
      } catch (err) {
        if ((err as Error).message === 'JOB_STOPPED') throw err;
        job.usersFailed = (job.usersFailed ?? 0) + 1;
        this.log(job, 'error', `✖ ${row.userName}: ${(err as Error).message}`);
        // رکورد ناقص با پرچم failedImport می‌ماند — بعداً رسیدگی می‌شود
        await this.markFailedImport(row.userName).catch(() => undefined);
        consecutiveFails++;
        // ۳ شکست پیاپی = مشکل سیستمی (قطعی/بلاک) — ادامه بی‌فایده و خطرناک است
        if (consecutiveFails >= 3) {
          throw new Error(
            `${consecutiveFails} شکست پیاپی — احتمالاً قطعی اینترنت یا بلاک شدن باسکول؛ جاب متوقف شد (بعداً از @${row.userName} ادامه دهید)`,
          );
        }
      }
    }
    this.finishJob(job);
  }

  /** یک کاربر باسکول را کامل ایمپورت می‌کند — خروجی: رکورد User ایمچ */
  private async importOneUser(
    job: JobInternal,
    bk: BuskoolClient,
    userName: string,
    phoneHint: string | undefined,
    maxProducts: number,
  ) {
    // ── ۱. پروفایل ──
    this.step(job, 'profile', 'active');
    this.log(job, 'info', `دریافت پروفایل @${userName} از باسکول…`);
    const profile: BkProfileResp = await bk.call('/load_profile_by_user_name', { user_name: userName });
    if (!profile?.user_info?.user_name) throw new Error(`کاربر باسکول @${userName} پیدا نشد`);
    const ui = profile.user_info;
    const pf = profile.profile;

    const statsResp: BkStatsResp | null = await bk
      .call<BkStatsResp>('/get_user_statistics_by_user_name', { user_name: userName })
      .catch(() => null);
    const st = statsResp?.statistics?.user_info;

    // شماره موبایل: دستی > جدول منبع > ساختگی از bUserId
    const phone =
      phoneHint ??
      (await this.sourcePhoneFor(userName)) ??
      (await this.uniqueFakePhone(ui.id, userName));

    // مکان از نام‌ها (اگر آگهی باشد، در مرحلهٔ بعد با id دقیق اصلاح می‌شود)
    const provinceLoc = ui.province
      ? await this.prisma.location.findFirst({ where: { type: 'province', name: ui.province } })
      : null;
    const cityLoc = ui.city && provinceLoc
      ? await this.prisma.location.findFirst({
          where: { type: 'city', name: ui.city, parentId: provinceLoc.id },
        })
      : null;

    const profileJson = {
      bUserId: ui.id,
      bProfileId: pf?.id ?? null,
      bAddress: pf?.address ?? null,
      bCompanyName: pf?.company_name ?? '',
      bDescription: pf?.description ?? null,
      bConfirmed: pf?.confirmed === 1,
      bActivityDomain: pf?.activity_domain ?? null,
      bRelateds: (profile.relateds ?? []).map((r) => r?.name ?? '').filter(Boolean),
      bResponseRate: st?.response_rate ?? null,
      bReputationScore: st?.reputation_score ?? null,
      bProductsCount: st?.products_count ?? null,
      importedFrom: 'buskool',
      importedAt: new Date().toISOString(),
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
        activePakageType: st?.active_package_type ?? ui.active_pakage_type ?? 0,
        provinceId: provinceLoc?.buskolId ?? null,
        cityId: cityLoc?.buskolId ?? null,
        profile: profileJson as object,
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
        activePakageType: st?.active_package_type ?? ui.active_pakage_type ?? 0,
        provinceId: provinceLoc?.buskolId ?? null,
        cityId: cityLoc?.buskolId ?? null,
        profile: profileJson as object,
        bUserName: userName,
        createdAt: this.bkDate(ui.created_at) ?? new Date(),
      },
    });
    this.step(job, 'profile', 'done');
    this.log(
      job,
      'success',
      `کاربر ${ui.first_name} ${ui.last_name} (@${userName}) ثبت شد — ایمچ #${user.id.slice(-6)} • باسکول #${ui.id}`,
    );

    // ── ۲. آواتار ──
    this.step(job, 'avatar', 'active');
    try {
      const av: BkAvatarResp = await bk.call('/get_user_last_confirmed_profile_photo', { user_id: ui.id });
      const avUrl =
        typeof av?.profile_photo === 'string'
          ? av.profile_photo
          : ((av?.profile_photo as { file_path?: string; url?: string } | null)?.file_path ??
            (av?.profile_photo as { url?: string } | null)?.url ??
            null);
      if (avUrl) {
        const img = await fetchImage(avUrl);
        if (img) {
          const processed = await processImage(img.buf);
          if (processed) {
            const key = `buskool/avatars/${userName}.${processed.ext}`;
            const url = await this.store.put(key, processed.main, processed.mime);
            await this.prisma.user.update({ where: { id: user.id }, data: { avatarUrl: url } });
            this.log(job, 'success', 'آواتار دانلود و ذخیره شد');
          }
        } else {
          this.log(job, 'warn', 'دانلود آواتار ناموفق بود — رد شد');
        }
      } else {
        this.step(job, 'avatar', 'skipped');
        this.log(job, 'info', 'آواتاری روی باسکول ثبت نشده است');
      }
    } catch (err) {
      if ((err as Error).message === 'JOB_STOPPED') throw err;
      this.step(job, 'avatar', 'skipped');
      this.log(job, 'warn', `آواتار رد شد: ${(err as Error).message}`);
    }

    // ── ۳. آگهی‌ها ──
    this.step(job, 'products', 'active');
    const items: BkProductItem[] = [];
    for (let from = 0; ; from += PAGE) {
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
    this.bump(job, 'productsTotal', items.length);
    this.log(job, 'info', `${items.length} آگهی عمومی از باسکول دریافت شد`);

    const catById = new Map<number, { parentId: number | null }>();
    for (const c of await this.prisma.category.findMany({ select: { id: true, parentId: true } })) {
      catById.set(c.id, { parentId: c.parentId });
    }

    let maxProductId = 0;
    for (const item of items) {
      if (job.stopRequested) throw new Error('JOB_STOPPED');
      const m = item.main;
      maxProductId = Math.max(maxProductId, m.id);
      await this.upsertProduct(job, m, user.id, catById);
      this.bump(job, 'products');
    }
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

    // ── ۴. عکس‌های آگهی‌ها ──
    this.step(job, 'images', 'active');
    for (const item of items) {
      if (job.stopRequested) throw new Error('JOB_STOPPED');
      const pid = item.main.id;
      // idempotent: اگر قبلاً rehost شده، رد شو
      const existing = await this.prisma.file.findFirst({
        where: { relatedModel: 'Product', relatedId: String(pid), fieldKey: 'gallery' },
        select: { id: true },
      });
      if (existing) continue;

      const detail = await bk
        .call<BkProductDetailResp>('/get_product_by_id', { product_id: pid })
        .catch(() => null);
      const photos = (detail?.product?.photos ?? [])
        .map((p) => p.file_path)
        .filter(Boolean)
        .slice(0, MAX_PHOTOS_PER_PRODUCT);
      if (!photos.length) continue;
      this.log(job, 'info', `عکس‌های آگهی #${pid} (${photos.length} مورد)…`);

      for (const [i, url] of photos.entries()) {
        if (job.stopRequested) throw new Error('JOB_STOPPED');
        const img = await fetchImage(url);
        if (!img) {
          this.bump(job, 'imagesFailed');
          continue;
        }
        const processed = await processImage(img.buf);
        if (!processed) {
          this.bump(job, 'imagesFailed');
          continue;
        }
        try {
          const stamp = Date.now().toString(36);
          const key = `buskool/products/${pid}/gallery/${stamp}-${i}.${processed.ext}`;
          const mainUrl = await this.store.put(key, processed.main, processed.mime);
          const thumbKey = `${key}.thumb.jpg`;
          const thumbUrl = await this.store.put(thumbKey, processed.thumb, 'image/jpeg');
          await this.prisma.file.create({
            data: {
              ownerId: user.id,
              relatedModel: 'Product',
              relatedId: String(pid),
              fieldKey: 'gallery',
              name: url.split('/').pop() ?? `buskool-${pid}-${i}`,
              mimeType: processed.mime,
              size: processed.main.length,
              url: mainUrl,
              thumbUrl,
              storageKey: null,
              thumbStorageKey: null,
              metadata: { importedFrom: 'buskool', originalUrl: url, originalSize: img.buf.length },
            },
          });
          this.bump(job, 'imagesDownloaded');
        } catch (err) {
          this.bump(job, 'imagesFailed');
          this.log(job, 'warn', `عکس ${pid}/${i} ناموفق: ${(err as Error).message}`);
        }
      }
    }
    this.step(job, 'images', 'done');

    // ── ۵. کامنت‌ها ──
    this.step(job, 'reviews', 'active');
    const comments: BkCommentsResp = await bk
      .call<BkCommentsResp>('/profile/get-user-comments', { user_id: ui.id })
      .catch(() => null as unknown as BkCommentsResp);
    const list = comments?.comments ?? [];
    for (const c of list) {
      if (job.stopRequested) throw new Error('JOB_STOPPED');
      if (!c.rating_score && !c.text) continue;
      // نویسندهٔ کمکی (stub) — با ایمپورت واقعی همان bUserId ادغام می‌شود
      const reviewer = await this.ensureStubReviewer(job, c);
      await this.prisma.sellerReview.upsert({
        where: { authorId_sellerId: { authorId: reviewer.id, sellerId: user.id } },
        update: {
          rating: c.rating_score ?? 5,
          text: (c.text ?? '').slice(0, 1000),
          status: 'approved',
          createdAt: this.bkDate(c.created_at) ?? new Date(),
        },
        create: {
          authorId: reviewer.id,
          sellerId: user.id,
          rating: c.rating_score ?? 5,
          text: (c.text ?? '').slice(0, 1000),
          status: 'approved',
          createdAt: this.bkDate(c.created_at) ?? new Date(),
        },
      });
      this.bump(job, 'reviews');
    }
    this.step(job, 'reviews', 'done');
    {
      const empty = list.filter((c) => !c.text).length;
      if (empty > 0 && !buskoolConfig().cookie) {
        this.log(job, 'warn', `${empty} کامنت بدون متن است — با BUSKOOL_COOKIE متن کامل گرفته می‌شود`);
      }
    }
    this.log(job, 'success', `${list.length} کامنت ثبت شد`);

    return user;
  }

  /** ثبت/بروزرسانی یک آگهی باسکول (الگوی scripts/seed-products.mjs) */
  private async upsertProduct(
    job: JobInternal,
    m: BkProductItem['main'],
    userId: string,
    catById: Map<number, { parentId: number | null }>,
  ) {
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
    await this.prisma.product.upsert({
      where: { id: m.id },
      update: {
        productName: name,
        description: (m.description ?? '').trim(),
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
        updatedAt: this.bkDate(m.updated_at) ?? new Date(),
      },
      create: {
        id: m.id,
        productName: name,
        slug: `فروش-عمده-${name}-${m.id}`,
        description: (m.description ?? '').trim(),
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
    });
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

  /** کاربر کمکی برای نویسندهٔ کامنت باسکول — userName یکتا بر اساس c_id */
  private async ensureStubReviewer(job: JobInternal, c: BkCommentsResp['comments'][number]) {
    let userName = `bk-c${c.c_id}`;
    // اگر قبلاً کاربری با همین bUserId ایمپورت شده، همان را بردار
    const existing = await this.prisma.user.findFirst({
      where: { userName },
    });
    if (existing) return existing;

    const phone = await this.uniqueFakePhone(c.user_id, userName);
    const cityLoc = c.city
      ? await this.prisma.location.findFirst({ where: { type: 'city', name: c.city } })
      : null;
    const user = await this.prisma.user.create({
      data: {
        phone,
        userName,
        firstName: c.first_name ?? '',
        lastName: c.last_name ?? '',
        role: 'USER',
        isSeller: false,
        isBuyer: true,
        cityId: cityLoc?.buskolId ?? null,
        profile: {
          bUserId: c.user_id,
          bStub: true,
          bCommentId: c.c_id,
          importedFrom: 'buskool-comment',
          importedAt: new Date().toISOString(),
        } as object,
      },
    });
    this.bump(job, 'stubUsers');
    return user;
  }

  /**
   * نشانه‌گذاری شکست ایمپورت (خواستهٔ مالک ۱۳-۱۱) — کاربر (حتی ناقص) با پرچم
   * failedImport می‌ماند تا بعداً رسیدگی شود؛ ایمپورت‌های بعدی هم از او رد
   * می‌شوند تا دادهٔ تکراری نسازد.
   */
  private async markFailedImport(userName: string) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ bUserName: userName }, { userName }] },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { failedImport: true, bUserName: userName },
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
            } as object,
          },
        });
        return;
      } catch {
        /* userName تکراری — پسوند تصادفی بعدی */
      }
    }
  }

  /** شمارهٔ ساختگی یکتا — «09» + ۹ رقم از id عددی باسکول (الگوی seed) */
  private async uniqueFakePhone(bkId: number, userName: string): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const candidate = `09${String(100000000 + ((bkId + i * 7919) % 900000000)).slice(-9)}`;
      const owner = await this.prisma.user.findUnique({ where: { phone: candidate }, select: { userName: true } });
      if (!owner || owner.userName === userName) return candidate;
    }
    return `09${String(Date.now()).slice(-9)}`;
  }

  /** تاریخ باسکول «2026-09-27 14:29:20» → Date (UTC) */
  private bkDate(s: string | null | undefined): Date | null {
    if (!s) return null;
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ─── درایور ذخیره‌سازی (یک‌بار per-job ساخته نمی‌شود — اشتراکی) ───────────

  private storeInstance?: Awaited<ReturnType<typeof buildStorage>>;
  private get store() {
    if (!this.storeInstance) this.storeInstance = buildStorage();
    return this.storeInstance;
  }

  // ═══════════════════════════ پاک‌سازی ═══════════════════════════

  /** پاک‌سازی کامل برای شروع مهاجرت — فقط حساب ادمین می‌ماند */
  async cleanup(adminPhone: string) {
    this.assertAdmin(adminPhone);
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

    // فایل‌های لوکال ایمپورتر — پاک‌سازی پوشهٔ buskool زیر uploads
    try {
      const buskoolDir = resolve(storage.UPLOAD_PATH, 'buskool');
      await rm(buskoolDir, { recursive: true, force: true });
      await mkdir(resolve(storage.UPLOAD_PATH), { recursive: true });
    } catch {
      /* بهترین‌حال */
    }
    counts.adminPhone = adminPhone;
    return counts;
  }

  // ═══════════════════════════ پیش‌نمایش ═══════════════════════════

  /** خواندن دادهٔ ایمپورت‌شدهٔ یک کاربر از دیتابیس ایمچ (قرارداد فرانت) */
  async preview(userName: string) {
    const user = await this.prisma.user.findUnique({ where: { userName } });
    if (!user) throw new ForbiddenException(`کاربر @${userName} در دیتابیس ایمچ نیست — اول ایمپورت کنید`);

    const [products, reviews, buyRequests, photoRows] = await Promise.all([
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
        bUserId: (pj.bUserId as number) ?? null,
        bActivePackageType: user.activePakageType,
        bResponseRate: (pj.bResponseRate as number) ?? null,
        bReputationScore: (pj.bReputationScore as string) ?? null,
      },
      profile: user.profile
        ? {
            address: (pj.bAddress as string) ?? null,
            companyName: (pj.bCompanyName as string) ?? '',
            description: (pj.bDescription as string) ?? null,
            confirmed: (pj.bConfirmed as boolean) ?? false,
            bRelateds: (pj.bRelateds as string[]) ?? [],
          }
        : null,
      avatar: {
        url: avatarUrl && avatarUrl.startsWith('http') ? avatarUrl : null,
        localUrl: avatarUrl && !avatarUrl.startsWith('http') ? avatarUrl : null,
      },
      counts: {
        products: await this.prisma.product.count({ where: { userId: user.id } }),
        photos: photoRows.filter((f) => productIds.has(f.relatedId ?? '')).length,
        reviews: await this.prisma.sellerReview.count({ where: { sellerId: user.id } }),
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
      reviews: reviews.map((r) => ({
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
    };
  }
}

// ─── تصویر: دانلود امن + پاین‌لاین (عین seed/سرویس uploads) ────────────────

async function fetchImage(rawUrl: string): Promise<{ buf: Buffer } | null> {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || /^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)) return null;
    const res = await fetch(u.toString(), {
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': 'Megan-importer/1.0', accept: 'image/*' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('image/') && !mime.startsWith('binary/') && !mime.startsWith('application/octet-stream')) {
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 8 * 1024 * 1024) return null;
    // امضای واقعی تصویر؟ (CDN باسکول گاهی octet-stream می‌فرستد)
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e;
    const isWebp = buf.slice(8, 12).toString('ascii') === 'WEBP';
    const isGif = buf.slice(0, 3).toString('ascii') === 'GIF';
    if (!isJpeg && !isPng && !isWebp && !isGif) return null;
    return { buf };
  } catch {
    return null;
  }
}

async function processImage(buf: Buffer): Promise<{
  main: Buffer;
  thumb: Buffer;
  mime: string;
  ext: string;
} | null> {
  try {
    const hasAlpha = !!(await sharp(buf).metadata()).hasAlpha;
    const main = await sharp(buf)
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .toFormat(hasAlpha ? 'png' : 'jpeg', hasAlpha ? { compressionLevel: 9 } : { quality: 82, mozjpeg: true })
      .toBuffer();
    const thumb = await sharp(buf)
      .rotate()
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .toFormat('jpeg', { quality: 78, mozjpeg: true })
      .toBuffer();
    return { main, thumb, mime: hasAlpha ? 'image/png' : 'image/jpeg', ext: hasAlpha ? 'png' : 'jpg' };
  } catch {
    return null; // تصویر خراب — رد می‌شود
  }
}
