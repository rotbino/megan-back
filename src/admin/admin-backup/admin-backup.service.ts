import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BSON, MongoClient } from 'mongodb';
import { AppError } from '../../common/errors/app-error';

/**
 * بک‌آپ دیتابیس (تسک ۳۳ — ۲۱-۱۱): کپی کامل و دقیق دیتابیس‌های سرور ابری
 * (Atlas) به مونگوی لوکالِ همان ماشینی که بک‌اند رویش اجرا می‌شود.
 *
 *  • مبدأ: DATABASE_URL (در پروفایل cloud همان Atlas است)
 *  • مقصد: LOCAL_MONGO_URL — پیش‌فرض mongodb://127.0.0.1:27017 بدون احراز
 *  • کپی «عین هم»: همهٔ اسناد با همان _id و انواع BSON، همهٔ ایندکس‌ها
 *    (بجز _id_)، ویوها و کالکشن‌های capped با همان گزینه‌ها
 *  • راستی‌آزمایی: شمار اسناد مبدأ/مقصد برای هر کالکشن
 *  • جاب در حافظه نگه داشته می‌شود و با getJob نظرسنجی می‌شود
 *
 * نکتهٔ استقرار: اگر بک‌اند روی ورسل اجرا شود «لوکال» یعنی کانتینر ورسل؛
 * UI همین را به ادمین گوشزد می‌کند و انتقال واقعی باید از بک‌اندِ روی
 * سیستم مالک انجام شود.
 */

/** دیتابیس‌های سیستمی مونگو — نه فهرست می‌شوند نه منتقل */
const SYSTEM_DBS = new Set(['admin', 'local', 'config']);

/** نام دیتابیس/کالکشن امن برای مسیردهی */
const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** سقف هر بچ درج — یا ۱۰۰۰ سند یا ۱۲MB (کوچک‌ترِ پیام سیم) */
const BATCH_DOCS = 1000;
const BATCH_BYTES = 12 * 1024 * 1024;

function localMongoUrl(): string {
  return process.env.LOCAL_MONGO_URL || 'mongodb://127.0.0.1:27017';
}

/** آدرس بدون اعتبارنامه — برای نمایش در UI
 *  (URL استاندارد روی رشتهٔ مونگو با چند هاستِ کاما-جدا خطا می‌خورد؛
 *   پس با regex مقاوم اعتبارنامه و کوئری جدا می‌شوند) */
function maskUrl(u: string): string {
  const scheme = u.trim().match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//)?.[1] ?? 'mongodb';
  const rest = u
    .trim()
    .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '') // اسکیم
    .replace(/^[^/@]*@/, '') // اعتبارنامه (user:pass@)
    .split('?')[0] // کوئری‌استرینگ
    .replace(/\/+$/, ''); // اسلش انتهایی
  return `${scheme}://${rest}`;
}

/** آیا دو رشتهٔ اتصال به یک سرور اشاره می‌کنند؟ (بدون اعتبارنامه/کوئری) */
function sameServer(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return a === b;
  }
}

/** خطای خوانا برای ادمین */
function friendlyError(err: unknown): string {
  const e = err as { message?: string; code?: number | string; name?: string };
  const msg = String(e?.message ?? err ?? '').slice(0, 220);
  if (e?.name === 'MongoServerSelectionError') {
    return 'سرور مونگو در دسترس نیست — اگر مقصد لوکال است، سرویس mongod را اجرا کنید و دوباره تلاش کنید.';
  }
  if (String(e?.code) === '8000' || /over your space quota/i.test(msg)) {
    return `سهمیهٔ فضای کلاستر ابری پر است و نوشتن بلاک شده: ${msg}`;
  }
  return msg || 'خطای ناشناخته';
}

export interface BackupCollectionInfo {
  name: string;
  type: 'collection' | 'view';
  count: number | null;
}

export interface BackupDatabaseInfo {
  name: string;
  dataBytes: number;
  storageBytes: number;
  collections: BackupCollectionInfo[];
}

export interface BackupCollectionProgress {
  name: string;
  type: 'collection' | 'view';
  status: 'pending' | 'copying' | 'indexes' | 'done' | 'error';
  sourceCount: number;
  copied: number;
  destCount: number | null;
  verified: boolean | null;
  indexesCreated: number;
  error?: string;
}

export interface BackupJob {
  id: string;
  database: string;
  targetDatabase: string;
  dropTarget: boolean;
  status: 'running' | 'done' | 'done_with_errors' | 'error';
  startedAt: string;
  finishedAt: string | null;
  totalCopied: number;
  collections: BackupCollectionProgress[];
  error?: string;
}

interface ConnectResult {
  client: MongoClient | null;
  error: string | null;
}

/** گزینه‌های ساخت کالکشن که باید عیناً بازسازی شوند (capped/timeseries/validator) */
function pickCreateOptions(info: { options?: Record<string, unknown> }): Record<string, unknown> | null {
  const o = info.options ?? {};
  const out: Record<string, unknown> = {};
  if (o.capped) {
    out.capped = true;
    if (typeof o.size === 'number' && o.size > 0) out.size = o.size;
    if (typeof o.max === 'number' && o.max > 0) out.max = o.max;
  }
  if (o.timeseries) out.timeseries = o.timeseries;
  if (o.validator) {
    out.validator = o.validator;
    if (o.validationLevel) out.validationLevel = o.validationLevel;
    if (o.validationAction) out.validationAction = o.validationAction;
  }
  return Object.keys(out).length ? out : null;
}

@Injectable()
export class AdminBackupService {
  private readonly logger = new Logger(AdminBackupService.name);
  private readonly jobs = new Map<string, BackupJob>();
  private current: BackupJob | null = null;

  /** POST /admin/backup/getInfo — دیتابیس‌های دو سرور + وضعیت اتصال‌ها */
  async getInfo() {
    const srcUrl = process.env.DATABASE_URL || '';
    const dstUrl = localMongoUrl();
    const [src, dst] = await Promise.all([this.connect(srcUrl, 8000), this.connect(dstUrl, 5000)]);
    try {
      let databases: BackupDatabaseInfo[] = [];
      let localDatabases: BackupDatabaseInfo[] = [];
      let sourceError: string | null = src.error;
      let localError: string | null = dst.error;

      if (src.client && !sourceError) {
        try {
          databases = await this.listDatabases(src.client);
        } catch (e) {
          sourceError = friendlyError(e);
        }
      }
      if (dst.client && !localError) {
        try {
          localDatabases = await this.listDatabases(dst.client);
        } catch (e) {
          localError = friendlyError(e);
        }
      }

      return {
        server: {
          isVercel: !!process.env.VERCEL,
          platform: process.platform,
          node: process.version,
          profile: process.env.APP_PROFILE === 'local' ? 'local' : 'cloud',
        },
        source: { url: maskUrl(srcUrl), ok: !sourceError, error: sourceError },
        local: { url: maskUrl(dstUrl), ok: !localError, error: localError },
        databases,
        localDatabases,
        currentJobId: this.current?.status === 'running' ? this.current.id : null,
      };
    } finally {
      await src.client?.close().catch(() => {});
      await dst.client?.close().catch(() => {});
    }
  }

  /** POST /admin/backup/transfer — شروع انتقال کامل یک دیتابیس به لوکال */
  async startTransfer(dto: { database: string; dropTarget?: boolean; targetDatabase?: string }): Promise<{ jobId: string }> {
    const database = (dto.database ?? '').trim();
    if (!database || !SAFE_NAME.test(database)) {
      throw AppError.badRequest('نام دیتابیس معتبر نیست.', 'BACKUP_BAD_DB');
    }
    if (SYSTEM_DBS.has(database)) {
      throw AppError.badRequest('دیتابیس سیستمی قابل انتقال نیست.', 'BACKUP_SYSTEM_DB');
    }
    const targetDatabase = (dto.targetDatabase ?? '').trim() || database;
    if (!SAFE_NAME.test(targetDatabase)) {
      throw AppError.badRequest('نام دیتابیس مقصد معتبر نیست.', 'BACKUP_BAD_TARGET');
    }
    const dropTarget = dto.dropTarget !== false;

    const srcUrl = process.env.DATABASE_URL || '';
    const dstUrl = localMongoUrl();
    if (!srcUrl) {
      throw AppError.badRequest('DATABASE_URL تنظیم نشده است.', 'BACKUP_NO_SOURCE');
    }
    // روی یک سرور، انتقال به خودش ممنوع — مگر اینکه مقصدِ متفاوت صریحاً خواسته
    // شده باشد (کاربرد آزمون/آینه‌سازی)
    if (sameServer(srcUrl, dstUrl) && targetDatabase === database) {
      throw AppError.conflict('مبدأ و مقصد یک سرور و یک نام‌اند — انتقال بی‌معنا است.', 'BACKUP_SAME_TARGET');
    }
    if (this.current?.status === 'running') {
      throw AppError.conflict(
        `انتقال «${this.current.database}» هنوز در جریان است — تا پایان آن صبر کنید.`,
        'BACKUP_BUSY',
      );
    }

    const job: BackupJob = {
      id: randomUUID(),
      database,
      targetDatabase,
      dropTarget,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      totalCopied: 0,
      collections: [],
    };
    this.jobs.set(job.id, job);
    this.pruneJobs();
    this.current = job;

    // اجرای پس‌زمینه — کنترلر منتظر نمی‌ماند؛ UI با getJob نظرسنجی می‌کند
    void this.runTransfer(job, srcUrl, dstUrl).catch((err: unknown) => {
      job.status = 'error';
      job.error = friendlyError(err);
      job.finishedAt = new Date().toISOString();
      this.logger.error(`backup-transfer: شکست کلی — ${job.error}`);
    });

    return { jobId: job.id };
  }

  /** POST /admin/backup/getJob — وضعیت لحظه‌ای جاب */
  async getJob(jobId: string): Promise<BackupJob> {
    const job = this.jobs.get(jobId);
    if (!job) throw AppError.notFound('چنین عملیات انتقالی یافت نشد.');
    return job;
  }

  // ─── داخلی ─────────────────────────────────────────────────────────────────

  private async connect(url: string, timeoutMs: number): Promise<ConnectResult> {
    if (!url) return { client: null, error: 'آدرس اتصال خالی است.' };
    const client = new MongoClient(url, { serverSelectionTimeoutMS: timeoutMs, maxPoolSize: 10 });
    try {
      await client.connect();
      // یک پینگ سبک — connect به‌تنهایی گاهی با خطای دیرهنگام برمی‌گردد
      await client.db('admin').command({ ping: 1 });
      return { client, error: null };
    } catch (e) {
      await client.close().catch(() => {});
      return { client: null, error: friendlyError(e) };
    }
  }

  /** فهرست دیتابیس‌های غیرسیستمی یک سرور با کالکشن‌ها و شمار تقریبی اسناد */
  private async listDatabases(client: MongoClient): Promise<BackupDatabaseInfo[]> {
    const { databases } = await client.db('admin').command({ listDatabases: 1 });
    const out: BackupDatabaseInfo[] = [];
    for (const d of databases) {
      if (SYSTEM_DBS.has(d.name)) continue;
      const db = client.db(d.name);
      const [stats, colls] = await Promise.all([
        db.command({ dbStats: 1, scale: 1 }).catch(() => null),
        db.listCollections().toArray().catch(() => [] as { name: string; type?: string }[]),
      ]);
      const usable = (colls as { name: string; type?: string }[]).filter((c) => !c.name.startsWith('system.'));
      const collections: BackupCollectionInfo[] = await Promise.all(
        usable.map(async (c) => ({
          name: c.name,
          type: (c.type as 'collection' | 'view') || 'collection',
          count:
            (c.type || 'collection') === 'view'
              ? null
              : await db.collection(c.name).estimatedDocumentCount().catch(() => null),
        })),
      );
      out.push({
        name: d.name,
        dataBytes: Number(stats?.dataSize ?? 0),
        storageBytes: Number(stats?.totalSize ?? d.sizeOnDisk ?? 0),
        collections: collections.sort((a, b) => (b.count ?? 0) - (a.count ?? 0)),
      });
    }
    return out.sort((a, b) => b.storageBytes - a.storageBytes);
  }

  /** مغز انتقال — کپی کامل کالکشن‌به‌کالکشن با ایندکس‌ها و راستی‌آزمایی */
  private async runTransfer(job: BackupJob, srcUrl: string, dstUrl: string): Promise<void> {
    const src = new MongoClient(srcUrl, { serverSelectionTimeoutMS: 10000, maxPoolSize: 20 });
    const dst = new MongoClient(dstUrl, { serverSelectionTimeoutMS: 8000, maxPoolSize: 20 });
    try {
      await src.connect();
      await dst.connect();

      const sdb = src.db(job.database);
      const ddb = dst.db(job.targetDatabase);

      // مبدأ باید واقعاً وجود داشته باشد
      const listed = (await src.db('admin').command({ listDatabases: 1 })) as {
        databases?: { name: string }[];
      };
      const names = (listed.databases ?? []).map((d) => d.name);
      if (!names.includes(job.database)) {
        throw AppError.badRequest(`دیتابیس «${job.database}» روی سرور ابری یافت نشد.`, 'BACKUP_SRC_MISSING');
      }

      const all = (await sdb.listCollections().toArray()) as {
        name: string;
        type?: string;
        options?: Record<string, unknown>;
      }[];
      const sorted = [
        ...all.filter((c) => (c.type || 'collection') !== 'view'),
        ...all.filter((c) => c.type === 'view'),
      ].filter((c) => !c.name.startsWith('system.'));

      job.collections = sorted.map((c) => ({
        name: c.name,
        type: (c.type as 'collection' | 'view') || 'collection',
        status: 'pending',
        sourceCount: 0,
        copied: 0,
        destCount: null,
        verified: null,
        indexesCreated: 0,
      }));

      for (const info of sorted) {
        const p = job.collections.find((x) => x.name === info.name);
        if (!p) continue;
        try {
          // ویو: فقط تعریفش بازسازی می‌شود (بعد از کالکشن‌ها — وابسته به viewOn)
          if (p.type === 'view') {
            if (job.dropTarget) await ddb.collection(info.name).drop().catch(() => {});
            const viewOn = info.options?.viewOn as string | undefined;
            if (viewOn) {
              const viewOpts: Record<string, unknown> = { viewOn };
              if (info.options?.pipeline) viewOpts.pipeline = info.options.pipeline;
              await ddb.createCollection(info.name, viewOpts as never);
            }
            p.status = 'done';
            p.verified = true;
            continue;
          }

          p.status = 'copying';
          p.sourceCount = await sdb.collection(info.name).countDocuments({});

          if (job.dropTarget) await ddb.collection(info.name).drop().catch(() => {});
          const createOpts = pickCreateOptions(info);
          if (createOpts) {
            await ddb.createCollection(info.name, createOpts).catch((e: unknown) => {
              if (!/NamespaceExists/i.test(String((e as Error)?.message ?? e))) throw e;
            });
          }

          // جریان کپی — حافظهٔ ثابت: بچ‌های ۱۰۰۰تایی/۱۲MB
          const dcoll = ddb.collection(info.name);
          let buf: unknown[] = [];
          let bufBytes = 0;
          const flush = async (): Promise<void> => {
            if (!buf.length) return;
            await dcoll.insertMany(buf as never[], { ordered: true });
            p.copied += buf.length;
            job.totalCopied += buf.length;
            buf = [];
            bufBytes = 0;
          };
          const cursor = sdb.collection(info.name).find({}).batchSize(BATCH_DOCS);
          for await (const doc of cursor) {
            buf.push(doc);
            bufBytes += BSON.calculateObjectSize(doc as never);
            if (buf.length >= BATCH_DOCS || bufBytes >= BATCH_BYTES) await flush();
          }
          await flush();

          // ایندکس‌ها — عین مبدأ (بجز _id_)
          p.status = 'indexes';
          const indexes = await sdb.collection(info.name).indexes();
          for (const ix of indexes) {
            if (ix.name === '_id_') continue;
            const opts: Record<string, unknown> = { name: ix.name };
            if (ix.unique) opts.unique = true;
            if (ix.sparse) opts.sparse = true;
            if (ix.expireAfterSeconds != null) opts.expireAfterSeconds = ix.expireAfterSeconds;
            if (ix.partialFilterExpression) opts.partialFilterExpression = ix.partialFilterExpression;
            if (ix.collation) opts.collation = ix.collation;
            if (ix.hidden != null) opts.hidden = ix.hidden;
            try {
              await ddb.collection(info.name).createIndex(ix.key as never, opts as never);
              p.indexesCreated++;
            } catch (e) {
              // شکست یک ایندکس کل انتقال را نمی‌شکند — فقط لاگ
              this.logger.warn(
                `backup-transfer: ایندکس «${ix.name}» روی ${info.name} ساخته نشد: ${String((e as Error)?.message ?? e).slice(0, 120)}`,
              );
            }
          }

          // راستی‌آزمایی — شمار دقیق اسناد دو طرف
          p.destCount = await ddb.collection(info.name).countDocuments({});
          p.verified = p.destCount === p.sourceCount;
          p.status = 'done';
        } catch (err) {
          p.status = 'error';
          p.error = friendlyError(err);
          this.logger.error(`backup-transfer: کالکشن «${info.name}» شکست خورد — ${p.error}`);
        }
      }

      job.status = job.collections.some((c) => c.status === 'error') ? 'done_with_errors' : 'done';
      this.logger.log(
        `backup-transfer: «${job.database}» ← «${job.targetDatabase}» ${job.status} — ${job.totalCopied} سند در ${job.collections.length} کالکشن`,
      );
    } finally {
      job.finishedAt = new Date().toISOString();
      await src.close().catch(() => {});
      await dst.close().catch(() => {});
    }
  }

  /** حافظه نه بی‌انتها — آخرین ۲۰ جاب نگه داشته می‌شود */
  private pruneJobs(): void {
    if (this.jobs.size <= 20) return;
    const oldest = [...this.jobs.entries()].sort((a, b) => a[1].startedAt.localeCompare(b[1].startedAt));
    while (this.jobs.size > 20 && oldest.length) {
      const [id, j] = oldest.shift()!;
      if (j.status === 'running') continue; // جاب جاری هرگز حذف نمی‌شود
      this.jobs.delete(id);
    }
  }
}
