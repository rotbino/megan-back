/**
 * مدیریت کاربران ایمپورت‌شده (خواستهٔ مالک ۱۳-۱۱) — پشت صفحهٔ
 * «دیتا ایمپورت → مدیریت کاربران» (بخش جدای ادمین).
 *
 * هدف: کنترل رفتار کاربران ایمپورت‌شده از پاسکال در کنار سایر کاربران —
 *   • چه کسی در پاسکال ویژه بوده و چه بسته‌ای خریده (b.premium) — برای
 *     تماس و دعوت به پرداخت؛ در آیمچ هیچ‌کس بدون پرداخت ویژه نیست.
 *   • کدام کاربر خودش ثبت‌نام کرده و کدام از پاسکال آمده (bUserName).
 *   • چه کسی بعد از تماس/دعوت واقعاً وارد اکانتش شده و کِی (lastLoginAt
 *     در برابر b.contactedAt).
 *   • آمار کامل هر کاربر + حذف کامل کاربران بی‌activity (پس از مثلاً یک
 *     سال، کاربرانی که هیچ‌وقت وارد نشده‌اند پاک می‌شوند و فقط فعال‌ها
 *     می‌مانند).
 *
 * پیاده‌سازی: فیلتر/سورت روی فیلد JSON «b» و شمارش آگهی‌ها با aggregation
 * خام مونگو ($runCommandRaw) — Prisma روی مسیرهای JSON تایپ‌امن نیست؛
 * نام فیلدهای خام (@map) اینجا عمداً استفاده می‌شود.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { generateUserName } from '../common/user-name';
import { buildStorage } from '../uploads/storage';
import { asBUserData, bkPackageTitle, type BUserData } from './b-user-data';
import { mongoDateRange } from './date-range.util';
import { importerAdminPhone } from './dto';

// ─── قرارداد API (آینهٔ فرانت: lib/importer/client.ts) ──────────────────────

export interface ImportedUserRow {
  id: string;
  phone: string;
  userName: string;
  bUserName: string | null;
  firstName: string;
  lastName: string;
  sex: string | null;
  avatarUrl: string | null;
  role: string;
  isActive: boolean;
  isVerified: boolean;
  /** (۲۰-۱۱) احراز هویت پاسکال — دادهٔ رفتاری، بدون اعتبار در آیمچ */
  bVerified: boolean;
  failedImport: boolean;
  /** دلیل آخرین شکست ایمپورت (خواستهٔ مالک ۱۵-۱۱) — از profile.bImportError؛
   *  null یعنی شکست قدیمی بدون ثبت دلیل یا ایمپورت سالم */
  importError: { message: string; sig: string; at: string } | null;
  /** کاربر کمکی نویسندهٔ کامنت پاسکال (bk-c*) — برای تفکیک آمار منبع */
  isStub: boolean;
  hasBusinessDesc: boolean;
  provinceId: number | null;
  cityId: number | null;
  provinceName: string | null;
  cityName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  /** سند پاسکال — null یعنی کاربر پاسکالی نیست (یا رکورد قدیمی) */
  b: BUserData | null;
  productsCount: number;
  /** (۱۹-۱۱) خودش با دکمهٔ «ایمپورت از وب» ایمپورت را انجام داده — ردّ پایهٔ
   *  «کاربر واقعی ایمچ»: حداقل یک جلسهٔ WebImportSession کامل‌شده دارد */
  selfImported: boolean;
  /** (تسک ۳۵ — ۲۱-۱۱) منبع ایمپورت — 'pascal' | 'daymat' | null (بومی) */
  importSource: string | null;
  /** (تسک ۳۵) سند دیمت — { daymatUserId, businessName, … } | null */
  d: Record<string, unknown> | null;
}

export interface ImportedUsersSummary {
  total: number;
  /** ایمپورت‌شده از پاسکال (bUserName پر) */
  pascal: number;
  /** خودشان ثبت‌نام کرده‌اند */
  native: number;
  /** کاربرهای کمکی نویسندهٔ کامنت (bk-c*) */
  stub: number;
  /** (تسک ۳۵ — ۲۱-۱۱) ایمپورت‌شده از دیمت (import_source='daymat') */
  daymat: number;
  /** ویژهٔ پاسکال (b.premium.isPremium) */
  premiumPascal: number;
  /** (۲۲-۱۱ — خواستهٔ مالک) تفکیک ویژه‌های پاسکال بر اساس نوع بسته‌ای که
   *  خریده‌اند (۱=دوماهه ۲=شش‌ماهه ۳=یک‌ساله) — برای برآورد درآمد پاسکال
   *  در کارت‌های بالای صفحهٔ مدیریت کاربران */
  premiumPackages: { packageType: number; title: string; count: number }[];
  /** هرگز وارد نشده‌اند */
  neverLoggedIn: number;
  /** با آن‌ها تماس/دعوت گرفته شده */
  contacted: number;
  /** بعد از تماس واقعاً وارد شده‌اند */
  cameAfterContact: number;
  /** ایمپورت ناقص/شکست‌خورده */
  failed: number;
  /** (۱۹-۱۱) خودشان ایمپورت از وب را انجام داده‌اند — کاربران واقعی ایمچ */
  selfImported: number;
  /** رکوردهای قدیمی که هنوز سند b ندارند — دکمهٔ «مهاجرت ساختار b» */
  needsMigration: number;
  /** (۲۰-۱۱) هنوز جداسازی هویت آیمچ/پاسکال نشده — یوزرنیم آیمچ == یوزرنیم
   *  پاسکال (یا الگوی لودهندهٔ bk-f-*) — دکمهٔ «جداسازی هویت» */
  needsIdentityFix: number;
}

export interface ImportedUsersListResult {
  rows: ImportedUserRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: ImportedUsersSummary;
}

export interface ImportedUsersQuery {
  q?: string;
  source?: 'pascal' | 'native' | 'stub' | 'daymat' | 'all';
  premium?: 'yes' | 'no';
  packageType?: number;
  login?: 'ever' | 'never' | 'after-contact';
  contacted?: 'yes' | 'no';
  failed?: 'yes' | 'no';
  /** (۱۹-۱۱) ایمپورت از وب با دست خود کاربر — جلسهٔ WebImportSession کامل‌شده */
  selfImport?: 'yes' | 'no';
  staleDays?: number;
  /** بازهٔ تاریخ ثبت‌نام — ISO میلادی (خواستهٔ مالک ۱۵-۱۱) */
  createdFrom?: string;
  createdTo?: string;
  sort?: 'lastLogin' | 'createdAt' | 'products' | 'pascalCreated' | 'imported' | 'contacted';
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

const OID_RE = /^[0-9a-fA-F]{24}$/;
const DAY_MS = 86_400_000;

/** escape کاراکترهای regex — جستجوی امن متن آزاد کاربر */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** خواندن امن یک عدد از $facet */
function facetCount(batch: Record<string, unknown>[], key: string): number {
  const arr = (batch?.[0]?.[key] ?? []) as { n?: number }[];
  return Number(arr?.[0]?.n ?? 0);
}

/**
 * تاریخ خروجی $runCommandRaw — Prisma نتیجه را به‌صورت Extended JSON
 * برمی‌گرداند (تاریخ = {$date: "…"}) نه Date جاوااسکریپت؛ هر دو شکل +
 * رشتهٔ خام ISO پذیرفته می‌شوند.
 */
function toIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v) return v;
  if (v && typeof v === 'object') {
    const d = (v as { $date?: unknown }).$date;
    if (typeof d === 'string') return d;
    if (d instanceof Date) return d.toISOString();
  }
  return null;
}

/** ObjectId خروجی $runCommandRaw — EJSON: {$oid: "…"}؛ هر دو شکل پذیرفته می‌شود */
function toId(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const oid = (v as { $oid?: unknown }).$oid;
    if (typeof oid === 'string') return oid;
  }
  return String(v);
}

/**
 * دلیل شکست ایمپورت از profile.bImportError (خواستهٔ مالک ۱۵-۱۱) —
 * نرمال‌سازی امن سند خام؛ خالی/خراب → null (شکست قدیمی بدون ثبت دلیل)
 */
function normalizeImportError(raw: unknown): { message: string; sig: string; at: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as { message?: unknown; sig?: unknown; at?: unknown };
  if (typeof e.message !== 'string' || !e.message) return null;
  return {
    message: e.message,
    sig: typeof e.sig === 'string' ? e.sig : '',
    at: typeof e.at === 'string' ? e.at : '',
  };
}

@Injectable()
export class ImportedUsersService {
  private readonly logger = new Logger(ImportedUsersService.name);
  private storeInstance?: Awaited<ReturnType<typeof buildStorage>>;

  constructor(private readonly prisma: PrismaService) {}

  private get store() {
    if (!this.storeInstance) this.storeInstance = buildStorage();
    return this.storeInstance;
  }

  private assertAdmin(adminPhone: string) {
    if (adminPhone !== importerAdminPhone()) {
      throw new ForbiddenException('این عملیات فقط برای حساب ادمین در دسترس است');
    }
  }

  // ═══════════════════════════ لیست + فیلتر + سورت ═══════════════════════════

  async list(query: ImportedUsersQuery): Promise<ImportedUsersListResult> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(5, query.pageSize ?? 20));
    const dir = query.dir === 'asc' ? 1 : -1;

    // ── فیلتر خام مونگو (نام فیلدها = @map اسکیما) ──
    const filter: Record<string, unknown> = {};
    const q = query.q?.trim();
    if (q) {
      const re = { $regex: escapeRegex(q), $options: 'i' };
      filter.$or = [{ phone: re }, { user_name: re }, { first_name: re }, { last_name: re }, { b_user_name: re }];
    }
    // منبع: پاسکال (bUserName پر) / بومی (خود ثبت‌نام کرده) / stub کامنت‌ها /
    // دیمت (تسک ۳۵ — import_source='daymat')
    if (query.source === 'pascal') filter.b_user_name = { $ne: null };
    else if (query.source === 'daymat') filter.import_source = 'daymat';
    else if (query.source === 'native') {
      filter.$and = [
        ...(filter.$and as unknown[] ?? []),
        { b_user_name: null },
        { 'profile.bStub': { $ne: true } },
      ];
    } else if (query.source === 'stub') filter['profile.bStub'] = true;

    // ویژهٔ پاسکال (فقط دادهٔ رفتاری — نه اعتبار آیمچ)
    if (query.premium === 'yes') filter['b.premium.isPremium'] = true;
    else if (query.premium === 'no') filter['b.premium.isPremium'] = { $ne: true };
    if (query.packageType !== undefined && query.packageType !== null) {
      filter['b.premium.packageType'] = query.packageType;
    }

    // رفتار ورود
    if (query.login === 'ever') filter.last_login_at = { $ne: null };
    else if (query.login === 'never') filter.last_login_at = null;
    else if (query.login === 'after-contact') {
      // بعد از تماس/دعوت آمده و لاگین کرده — مقایسهٔ Date مونگو با ISO استرینگِ b.
      // ⚠️ دو گارد لازم است (رفتار $expr با query فرق دارد):
      //   • مسیر غایب در $expr برابر null «نیست» → $ne:true می‌دهد؛ وجود را با
      //     $ifNull>'' چک می‌کنیم
      //   • در مقایسهٔ BSON، Date > null برابر true است → بدون گارد، همهٔ
      //     لاگین‌کرده‌ها می‌افتادند وسط
      filter.$and = [
        ...(filter.$and as unknown[] ?? []),
        { last_login_at: { $ne: null } },
        {
          $expr: {
            $and: [
              { $gt: [{ $ifNull: ['$b.contactedAt', ''] }, ''] },
              { $gt: ['$last_login_at', { $toDate: '$b.contactedAt' }] },
            ],
          },
        },
      ];
    }

    // CRM تماس
    if (query.contacted === 'yes') filter['b.contactedAt'] = { $ne: null };
    else if (query.contacted === 'no') filter['b.contactedAt'] = null;

    // ایمپورت ناقص
    if (query.failed === 'yes') filter.failed_import = true;
    else if (query.failed === 'no') filter.failed_import = { $ne: true };

    // (۱۹-۱۱) «ایمپورت خودی» — کاربر خودش با دکمهٔ «ایمپورت از وب» کالاهایش
    // را آورده (جلسهٔ کامل‌شده)؛ نشانهٔ کاربر واقعی ایمچ. فیلد روی خود کاربر
    // نیست و با $lookup در پایپ‌لاین ساخته می‌شود — اینجا فقط پرچم می‌گیریم.
    const wantSelfImport = query.selfImport === 'yes' || query.selfImport === 'no';

    // «رهاشده»: هرگز وارد نشده + بیش از N روز از ایمپورتش گذشته — پایهٔ
    // پاک‌سازی سالانهٔ کاربران بی‌activity (خواستهٔ مالک)
    if (query.staleDays && query.staleDays > 0) {
      const cutoff = new Date(Date.now() - query.staleDays * DAY_MS).toISOString();
      filter.$and = [
        ...(filter.$and as unknown[] ?? []),
        { last_login_at: null },
        { 'b.importedAt': { $lt: cutoff } },
      ];
    }

    // بازهٔ تاریخ ثبت‌نام (خواستهٔ مالک ۱۵-۱۱): «در هر بازه چند نفر ثبت‌نام
    // کرده‌اند» — created_at BSON Date است → EJSON {$date} (date-range.util)
    const createdRange = mongoDateRange(query.createdFrom, query.createdTo);
    if (createdRange) {
      filter.$and = [
        ...(filter.$and as unknown[] ?? []),
        { created_at: createdRange },
      ];
    }

    // ── سورت (نام فیلد خام بر اساس کلید فرانت) ──
    const sortKey: Record<string, string> = {
      lastLogin: 'last_login_at',
      createdAt: 'created_at',
      products: 'productsCount',
      pascalCreated: 'b.createdAt',
      imported: 'b.importedAt',
      contacted: 'b.contactedAt',
    };
    const sortField = sortKey[query.sort ?? 'lastLogin'] ?? 'last_login_at';

    // ── aggregation: شمارش آگهی هر کاربر + جلسهٔ ایمپورت خودی + facet صفحه‌بندی ──
    // (سورت روی productsCount و فیلترهای مسیر JSON فقط در aggregation ممکن است)
    const pipeline: Record<string, unknown>[] = [
      { $match: filter },
      {
        $lookup: {
          from: 'Product',
          let: { uid: '$_id' },
          pipeline: [{ $match: { $expr: { $eq: ['$user_id', '$$uid'] } } }, { $count: 'n' }],
          as: '_pc',
        },
      },
      { $addFields: { productsCount: { $ifNull: [{ $arrayElemAt: ['$_pc.n', 0] }, 0] } } },
      // جلسهٔ ایمپورت از وبِ خود کاربر (۱۹-۱۱) — status done یعنی خودش دکمه را
      // زده و تا انتها برده؛ هر دو مود (full/prices) «انجام با دست خودش» است
      {
        $lookup: {
          from: 'WebImportSession',
          let: { uid: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$user_id', '$$uid'] }, status: 'done' } },
            { $limit: 1 },
            { $count: 'n' },
          ],
          as: '_wic',
        },
      },
      {
        $addFields: {
          selfImported: { $gt: [{ $ifNull: [{ $arrayElemAt: ['$_wic.n', 0] }, 0] }, 0] },
        },
      },
      // فیلتر «ایمپورت خودی» بعد از ساخت فیلد (نه روی سند خام)
      ...(wantSelfImport ? [{ $match: { selfImported: query.selfImport === 'yes' } }] : []),
      {
        $facet: {
          rows: [
            { $sort: { [sortField]: dir, _id: 1 } },
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize },
            {
              $project: {
                _id: 1,
                phone: 1,
                user_name: 1,
                b_user_name: 1,
                first_name: 1,
                last_name: 1,
                sex: 1,
                avatar_url: 1,
                role: 1,
                is_active: 1,
                is_verified: 1,
                b_verified: 1,
                failed_import: 1,
                import_error: '$profile.bImportError',
                is_stub: { $eq: ['$profile.bStub', true] },
                business_desc: 1,
                province_id: 1,
                city_id: 1,
                created_at: 1,
                last_login_at: 1,
                b: 1,
                d: 1,
                import_source: 1,
                productsCount: 1,
                selfImported: 1,
              },
            },
          ],
          total: [{ $count: 'n' }],
        },
      },
    ];

    const agg = (await this.prisma.$runCommandRaw({
      aggregate: 'User',
      pipeline: pipeline as unknown as Prisma.InputJsonObject[],
      cursor: {},
    })) as unknown as { cursor?: { firstBatch?: Record<string, unknown>[] } };
    const facet = agg?.cursor?.firstBatch?.[0] ?? {};
    const rawRows = (facet.rows ?? []) as Record<string, unknown>[];
    const total = Number(((facet.total ?? []) as { n?: number }[])[0]?.n ?? 0);

    // ── نام استان/شهر برای ردیف‌های این صفحه ──
    const provIds = [...new Set(rawRows.map((r) => r.province_id).filter((x): x is number => x != null))];
    const cityIds = [...new Set(rawRows.map((r) => r.city_id).filter((x): x is number => x != null))];
    const [provs, cities] = await Promise.all([
      provIds.length
        ? this.prisma.location.findMany({
            where: { pascalId: { in: provIds } },
            select: { pascalId: true, name: true, type: true },
          })
        : [],
      cityIds.length
        ? this.prisma.location.findMany({
            where: { pascalId: { in: cityIds } },
            select: { pascalId: true, name: true, type: true },
          })
        : [],
    ]);
    const provName = new Map(provs.filter((p) => p.type === 'province').map((p) => [p.pascalId, p.name]));
    const cityName = new Map(cities.filter((c) => c.type === 'city').map((c) => [c.pascalId, c.name]));

    const rows: ImportedUserRow[] = rawRows.map((r) => {
      const lastLoginIso = toIso(r.last_login_at);
      const createdIso = toIso(r.created_at) ?? '';
      return {
        id: toId(r._id),
        phone: String(r.phone ?? ''),
        userName: String(r.user_name ?? ''),
        bUserName: (r.b_user_name as string) ?? null,
        firstName: String(r.first_name ?? ''),
        lastName: String(r.last_name ?? ''),
        sex: (r.sex as string) ?? null,
        avatarUrl: (r.avatar_url as string) ?? null,
        role: String(r.role ?? 'USER'),
        isActive: r.is_active !== false,
        isVerified: r.is_verified === true,
        bVerified: r.b_verified === true,
        failedImport: r.failed_import === true,
        importError: normalizeImportError(r.import_error),
        isStub: r.is_stub === true,
        hasBusinessDesc: Boolean((r.business_desc as string | null)?.trim()),
        provinceId: (r.province_id as number) ?? null,
        cityId: (r.city_id as number) ?? null,
        provinceName: provName.get((r.province_id as number) ?? -1) ?? null,
        cityName: cityName.get((r.city_id as number) ?? -1) ?? null,
        createdAt: createdIso,
        lastLoginAt: lastLoginIso,
        b: asBUserData(r.b),
        d: (r.d as Record<string, unknown> | null) ?? null,
        importSource: (r.import_source as string | null) ?? null,
        productsCount: Number(r.productsCount ?? 0),
        selfImported: r.selfImported === true,
      };
    });

    return {
      rows,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      summary: await this.summary(),
    };
  }

  /** آمار کلی (مستقل از فیلترها) — کارت‌های بالای صفحه */
  async summary(): Promise<ImportedUsersSummary> {
    const agg = (await this.prisma.$runCommandRaw({
      aggregate: 'User',
      pipeline: [
        {
          $facet: {
            total: [{ $count: 'n' }],
            pascal: [{ $match: { b_user_name: { $ne: null } } }, { $count: 'n' }],
            native: [
              { $match: { b_user_name: null, 'profile.bStub': { $ne: true } } },
              { $count: 'n' },
            ],
            stub: [{ $match: { 'profile.bStub': true } }, { $count: 'n' }],
            // (تسک ۳۵ — ۲۱-۱۱) ایمپورت‌شده از دیمت
            daymat: [{ $match: { import_source: 'daymat' } }, { $count: 'n' }],
            premiumPascal: [{ $match: { 'b.premium.isPremium': true } }, { $count: 'n' }],
            // (۲۲-۱۱) تفکیک ویژه‌ها بر اساس نوع بسته — مبنای برآورد درآمد پاسکال
            premiumPackages: [
              { $match: { 'b.premium.isPremium': true } },
              { $group: { _id: '$b.premium.packageType', n: { $sum: 1 } } },
              { $sort: { _id: 1 } },
            ],
            neverLoggedIn: [{ $match: { last_login_at: null } }, { $count: 'n' }],
            contacted: [{ $match: { 'b.contactedAt': { $ne: null } } }, { $count: 'n' }],
            cameAfterContact: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $gt: [{ $ifNull: ['$b.contactedAt', ''] }, ''] },
                      { $gt: ['$last_login_at', { $toDate: '$b.contactedAt' }] },
                    ],
                  },
                },
              },
              { $count: 'n' },
            ],
            failed: [{ $match: { failed_import: true } }, { $count: 'n' }],
            // (۱۹-۱۱) خودشان ایمپورت از وب را کامل کرده‌اند — کاربران واقعی ایمچ
            selfImported: [
              {
                $lookup: {
                  from: 'WebImportSession',
                  let: { uid: '$_id' },
                  pipeline: [
                    { $match: { $expr: { $eq: ['$user_id', '$$uid'] }, status: 'done' } },
                    { $limit: 1 },
                  ],
                  as: '_wic',
                },
              },
              { $match: { $expr: { $gt: [{ $size: '$_wic' }, 0] } } },
              { $count: 'n' },
            ],
            needsMigration: [{ $match: { b_user_name: { $ne: null }, b: null } }, { $count: 'n' }],
            // (۲۰-۱۱) جداسازی هویت لازم دارد: یوزرنیم آیمچ == یوزرنیم پاسکال،
            // یا الگوی قدیمیِ لودهندهٔ bk-f-* — پس از fix-identity صفر می‌شود
            needsIdentityFix: [
              {
                $match: {
                  $or: [
                    { $expr: { $eq: ['$user_name', '$b_user_name'] } },
                    { user_name: { $regex: '^bk-f-' } },
                    { user_name: { $regex: '^bk-c-' } },
                  ],
                },
              },
              { $count: 'n' },
            ],
          },
        },
      ],
      cursor: {},
    })) as unknown as { cursor?: { firstBatch?: Record<string, unknown>[] } };
    const f = agg?.cursor?.firstBatch?.[0] ?? {};
    // تفکیک بسته‌ها (۲۲-۱۱) — خروجی $group [{_id: packageType, n}]؛ بستهٔ ۰
    // (رایگان) و مقادیر ناشناخته کنار گذاشته می‌شوند
    const pkgRows = ((f.premiumPackages ?? []) as { _id?: number; n?: number }[])
      .map((r) => ({ packageType: Number(r._id ?? 0), count: Number(r.n ?? 0) }))
      .filter((r) => r.packageType > 0 && r.count > 0);
    return {
      total: facetCount([f], 'total'),
      pascal: facetCount([f], 'pascal'),
      native: facetCount([f], 'native'),
      stub: facetCount([f], 'stub'),
      daymat: facetCount([f], 'daymat'),
      premiumPascal: facetCount([f], 'premiumPascal'),
      premiumPackages: pkgRows.map((r) => ({
        packageType: r.packageType,
        title: bkPackageTitle(r.packageType),
        count: r.count,
      })),
      neverLoggedIn: facetCount([f], 'neverLoggedIn'),
      contacted: facetCount([f], 'contacted'),
      cameAfterContact: facetCount([f], 'cameAfterContact'),
      failed: facetCount([f], 'failed'),
      selfImported: facetCount([f], 'selfImported'),
      needsMigration: facetCount([f], 'needsMigration'),
      needsIdentityFix: facetCount([f], 'needsIdentityFix'),
    };
  }

  // ═══════════════════════════ جزئیات یک کاربر ═══════════════════════════

  async detail(id: string) {
    if (!OID_RE.test(id)) throw new BadRequestException('شناسه کاربر نامعتبر است');
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        phone: true,
        userName: true,
        bUserName: true,
        firstName: true,
        lastName: true,
        sex: true,
        role: true,
        isActive: true,
        isVerified: true,
        bVerified: true,
        isBuyer: true,
        isSeller: true,
        avatarUrl: true,
        businessDesc: true,
        walletBalance: true,
        activePakageType: true,
        provinceId: true,
        cityId: true,
        profile: true,
        b: true,
        d: true,
        importSource: true,
        failedImport: true,
        lastLoginAt: true,
        lastSeenAt: true,
        createdAt: true,
        catalog: { select: { catalogId: true } },
      },
    });
    if (!user) throw new NotFoundException('کاربر پیدا نشد');

    const [products, productsCount, reviewsReceived, bCommentsReceived, reviewsWritten, buyRequests, photos, supplyOffers] =
      await Promise.all([
        this.prisma.product.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            productName: true,
            minSalePrice: true,
            stock: true,
            unit: true,
            status: true,
            isElevated: true,
            subCategoryId: true,
            createdAt: true,
          },
        }),
        this.prisma.product.count({ where: { userId: id } }),
        this.prisma.sellerReview.count({ where: { sellerId: id } }),
        // کامنت‌های پاسکالی درباره این فروشنده — جدول b_comment (خاستهٔ مالک ۱۳-۱۱)
        this.prisma.bComment.count({ where: { sellerId: id } }),
        this.prisma.sellerReview.count({ where: { authorId: id } }),
        this.prisma.buyRequest.count({ where: { userId: id } }),
        this.prisma.file.count({ where: { ownerId: id } }),
        this.prisma.supplyOffer.count({ where: { OR: [{ sellerId: id }, { buyerId: id }] } }),
      ]);

    const catIds = [...new Set(products.map((p) => p.subCategoryId))];
    const [cats, provs, cities] = await Promise.all([
      catIds.length
        ? this.prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, categoryName: true } })
        : [],
      user.provinceId
        ? this.prisma.location.findFirst({
            where: { pascalId: user.provinceId, type: 'province' },
            select: { name: true },
          })
        : null,
      user.cityId
        ? this.prisma.location.findFirst({
            where: { pascalId: user.cityId, type: 'city' },
            select: { name: true },
          })
        : null,
    ]);
    const catName = new Map(cats.map((c) => [c.id, c.categoryName]));

    return {
      user: {
        id: user.id,
        phone: user.phone,
        userName: user.userName,
        bUserName: user.bUserName,
        firstName: user.firstName,
        lastName: user.lastName,
        sex: user.sex,
        role: user.role,
        isActive: user.isActive,
        isVerified: user.isVerified,
        bVerified: user.bVerified,
        isBuyer: user.isBuyer,
        isSeller: user.isSeller,
        avatarUrl: user.avatarUrl,
        businessDesc: user.businessDesc,
        walletBalance: user.walletBalance,
        activePakageType: user.activePakageType,
        provinceName: provs?.name ?? null,
        cityName: cities?.name ?? null,
        profile: (user.profile ?? null) as Record<string, unknown> | null,
        b: asBUserData(user.b),
        d: (user.d ?? null) as Record<string, unknown> | null,
        importSource: (user as { importSource?: string | null }).importSource ?? null,
        failedImport: user.failedImport,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        catalogId: user.catalog?.catalogId ?? null,
      },
      counts: {
        products: productsCount,
        // مجموع نظرات واقعی + کامنت‌های پاسکالی — همان چیزی که بازدیدکننده می‌بیند
        reviewsReceived: reviewsReceived + bCommentsReceived,
        bCommentsReceived,
        reviewsWritten,
        buyRequests,
        photos,
        supplyOffers,
      },
      products: products.map((p) => ({
        id: p.id,
        name: p.productName,
        price: p.minSalePrice || null,
        stock: p.stock,
        unit: p.unit,
        status: p.status,
        isElevated: p.isElevated,
        category: catName.get(p.subCategoryId) ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  // ═══════════════════════════ CRM — علامت تماس/دعوت ═══════════════════════════

  /** ثبت/برداشتن «با این کاربر تماس گرفتم و دعوتش کردم» — b.contactedAt */
  async markContacted(id: string, undo = false) {
    if (!OID_RE.test(id)) throw new BadRequestException('شناسه کاربر نامعتبر است');
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, b: true } });
    if (!user) throw new NotFoundException('کاربر پیدا نشد');
    const b = asBUserData(user.b);
    if (!b) {
      throw new BadRequestException(
        'این کاربر سند دادهٔ پاسکالی (b) ندارد — اگر رکورد قدیمی است، اول «مهاجرت ساختار b» را اجرا کنید',
      );
    }
    b.contactedAt = undo ? null : new Date().toISOString();
    await this.prisma.user.update({ where: { id }, data: { b: b as object } });
    return { id, contactedAt: b.contactedAt };
  }

  // ═══════════════════════════ مهاجرت ساختار b (رکوردهای قدیمی) ═══════════════════════════

  /**
   * رکوردهای ایمپورت‌شدهٔ قبل از فیلد b را به ساختار جدید می‌برد:
   *   • فیلدهای b_* پراکنده در profile → سند یکپارچهٔ b
   *   • activePakageType (که قدیماً از پاسکال کپی می‌شد!) → b.premium و
   *     سپس صفر — کاربر در آیمچ دیگر به‌خاطر پاسکال ویژه نیست (خواستهٔ مالک).
   * idempotent است: رکوردهای دارای b رد می‌شوند.
   */
  async migrateB(adminPhone: string) {
    this.assertAdmin(adminPhone);
    // Prisma روی فیلد JSON nullable مقدار null را در where نمی‌پذیرد —
    // «بدون b» در جاوااسکریپت فیلتر می‌شود (تعداد رکوردها کم است)
    const allImported = await this.prisma.user.findMany({
      where: { bUserName: { not: null } },
      select: {
        id: true,
        bUserName: true,
        firstName: true,
        lastName: true,
        sex: true,
        isVerified: true,
        isBuyer: true,
        isSeller: true,
        activePakageType: true,
        provinceId: true,
        cityId: true,
        profile: true,
        b: true,
        createdAt: true,
      },
    });
    const legacyUsers = allImported.filter((u) => u.b == null);

    let migrated = 0;
    let premiumFixed = 0;
    for (const u of legacyUsers) {
      const pj = (u.profile ?? {}) as Record<string, unknown>;
      const packageType = u.activePakageType ?? 0; // قدیماً مقدار پاسکال اینجا کپی می‌شد
      const [prov, city] = await Promise.all([
        u.provinceId
          ? this.prisma.location.findFirst({
              where: { pascalId: u.provinceId, type: 'province' },
              select: { name: true },
            })
          : null,
        u.cityId
          ? this.prisma.location.findFirst({
              where: { pascalId: u.cityId, type: 'city' },
              select: { name: true },
            })
          : null,
      ]);

      const b: BUserData = {
        source: 'pascal',
        userName: u.bUserName as string,
        userId: (pj.bUserId as number) ?? 0,
        profileId: (pj.bProfileId as number) ?? null,
        premium: {
          isPremium: packageType > 0,
          packageType,
          packageTitle: bkPackageTitle(packageType),
        },
        isVerified: u.isVerified,
        isBuyer: u.isBuyer,
        isSeller: u.isSeller,
        isBlocked: false,
        walletBalance: 0,
        phoneViewPermission: null,
        categoryId: null,
        customerStatus: null,
        supportStatus: null,
        comingFrom: null,
        activityType: null,
        activityDomain: (pj.activityDomain as string) ?? null,
        sex: u.sex,
        province: prov?.name ?? null,
        city: city?.name ?? null,
        address: (pj.address as string) ?? null,
        postalCode: null,
        isCompany: (pj.isCompany as boolean) ?? false,
        companyName: (pj.companyName as string) ?? '',
        companyRegisterCode: null,
        confirmed: (pj.bConfirmed as boolean) ?? false,
        relateds: (pj.bRelateds as string[]) ?? [],
        profilePhotoUrl: null,
        descriptionRaw: null,
        descriptionIsAuto: false,
        responseRate: (pj.bResponseRate as number) ?? null,
        reputationScore: (pj.bReputationScore as string) ?? null,
        productsCount: (pj.bProductsCount as number) ?? null,
        ratingCount: null,
        ratingAvg: null,
        ibp: false,
        createdAt: u.createdAt.toISOString(),
        importedAt: (pj.importedAt as string) ?? u.createdAt.toISOString(),
        contactedAt: null,
      };

      // پروفایل جدید — فقط کلیدهای استاندارد آیمچ؛ کلیدهای b_* قدیمی حذف می‌شوند
      const profileNew = {
        address: (pj.address as string) ?? null,
        isCompany: (pj.isCompany as boolean) ?? false,
        companyName: (pj.companyName as string) ?? '',
        activityDomain: (pj.activityDomain as string) ?? null,
      };

      await this.prisma.user.update({
        where: { id: u.id },
        data: { b: b as object, profile: profileNew as object, activePakageType: 0 },
      });
      migrated++;
      if (packageType > 0) premiumFixed++;
    }

    this.logger.log(`migrate-b: ${migrated} migrated, ${premiumFixed} premium reset`);
    return { migrated, premiumFixed, skipped: legacyUsers.length === 0 ? 0 : 0 };
  }

  // ═══════════════════════════ جداسازی هویت آیمچ/پاسکال ═══════════════════════════

  /**
   * مهاجرت جداسازی هویت (خواستهٔ مالک ۲۰-۱۱) — **قابل ازسرگیری**:
   *
   *   ۱) احراز هویت — isVerifiedِ همه false می‌شود (هیچ کاربری واقعاً در آیمچ
   *      احراز نشده؛ مقدار فعلی از پاسکال کپی شده بود). مقدار پاسکال در
   *      bVerified (b_verified) نگه داشته می‌شود: isVerified قدیمی یا b.isVerified.
   *      استثنا: کاربرانی که پروندهٔ احراز تأییدشده دارند (VerificationOrder
   *      approved) — احراز واقعی‌اند و true می‌مانند.
   *
   *   ۲) یوزرنیم — برای هر کاربری که یوزرنیم آیمچش با یوزرنیم پاسکالش یکی
   *      است (یا الگوی قدیمی bk-f-* / bk-c-* دارد)، یوزرنیم آیمچ تصادفی و
   *      یکتا ساخته می‌شود (مستقل از پاسکال). یوزرنیم پاسکال در bUserName
   *      هست و دست نمی‌خورد — کلید ایمپورت/آپدیت قیمت‌های بعدی پاسکال.
   *      ردپای تحلیل (ActivityLog.catalogUserName) هم با نام جدید هماهنگ می‌شود.
   *
   * سقف تابع سرورلس ورسل ۶۰ ثانیه است — هر فراخوانی حداکثر `batch` (پیش‌فرض
   * ۵۰۰) تغییرنام انجام می‌دهد و «remaining» برمی‌گرداند؛ فراخوانی مجدد تا
   * done:true کار را ادامه می‌دهد (idempotent: اجرای دوباره فقط تازه‌رسیده‌ها
   * را می‌گیرد؛ احرازِ واقعیِ بعدی هرگز پاک نمی‌شود).
   */
  async fixIdentity(adminPhone: string, batchArg?: string) {
    this.assertAdmin(adminPhone);
    const batch = Math.min(2000, Math.max(50, Number(batchArg) || 500));

    // پاسخ دستور update خام مونگو: { n, nModified } (و نه modifiedCount)
    const modCount = (r: unknown): number => {
      const x = r as { nModified?: number; modifiedCount?: number; n?: number } | null;
      return Number(x?.nModified ?? x?.modifiedCount ?? x?.n ?? 0);
    };

    // فیلتر «نیاز به تغییرنام» — تساوی دو فیلد فقط با $expr مونگو ممکن است
    const renameFilter = {
      $or: [
        { $expr: { $eq: ['$user_name', '$b_user_name'] } },
        { user_name: { $regex: '^bk-f-' } },
        { user_name: { $regex: '^bk-c-' } },
      ],
    };

    // ── ۱) احراز هویت (فقط در نخستین فراخوانی کار واقعی دارد؛ بعدی‌ها no-op) ──
    // الف) b_verified برای کاربران پاسکالی: از is_verified قدیمی یا b.isVerified
    const setBFromVerified = await this.prisma.$runCommandRaw({
      update: 'User',
      updates: [
        {
          q: {
            b_user_name: { $ne: null },
            $or: [{ is_verified: true }, { 'b.isVerified': true }],
          },
          u: { $set: { b_verified: true } },
          multi: true,
        },
      ],
    });
    // ب) is_verified = false برای همه — به‌جز پرونده‌های احرازِ واقعاً تأییدشده
    const approved = await this.prisma.verificationOrder.findMany({
      where: { status: 'approved' },
      select: { userId: true },
    });
    const approvedOids = approved.map((v) => ({ $oid: v.userId }));
    const clearVerified = await this.prisma.$runCommandRaw({
      update: 'User',
      updates: [
        {
          q: {
            is_verified: true,
            ...(approvedOids.length ? { _id: { $nin: approvedOids } } : {}),
          },
          u: { $set: { is_verified: false } },
          multi: true,
        },
      ],
    });
    // ج) b_verified صریح false برای بقیه (تا هیچ سندی بدون فیلد نماند)
    await this.prisma.$runCommandRaw({
      update: 'User',
      updates: [{ q: { b_verified: { $ne: true } }, u: { $set: { b_verified: false } }, multi: true }],
    });

    // ── ۲) تغییرنام‌ها — فقط `batch` نفر در این فراخوانی ──
    // ⚠️ batchSize صریح لازم است: پاسخ find خام مونگو پیش‌فرض فقط ۱۰۱ سند
    // در firstBatch برمی‌گرداند و بدون آن هر فراخوانی فقط ۱۰۱ نفر را می‌گرفت
    const rawDocs = (await this.prisma.$runCommandRaw({
      find: 'User',
      filter: renameFilter,
      limit: batch,
      batchSize: batch,
      projection: { _id: 1, user_name: 1, b_user_name: 1 },
    })) as unknown as { cursor?: { firstBatch?: Record<string, unknown>[] } };
    const docs = rawDocs?.cursor?.firstBatch ?? [];

    // تغییرنام‌ها با «یک» دستور update خام و آرایهٔ statements — یک رفت‌وبرگشت
    // به‌جای صدها (تأخیرِ بالا‌ی Atlas از ورسل با فراخوانی‌های تکی غیرقابل‌تحمل بود).
    // ordered:false → خطای یک statement (برخورد نادر کلید یکتا) بقیه را نمی‌اندازد؛
    // نام برخوردکرده همان کاربر می‌ماند و فراخوانی بعدی با نام تازه retry می‌شود.
    let renamed = 0;
    let renameFailed = 0;
    if (docs.length) {
      const userStatements: Record<string, unknown>[] = [];
      const logStatements: Record<string, unknown>[] = [];
      const used = new Set<string>();
      for (const d of docs) {
        const id = toId(d._id);
        const oldName = String(d.user_name ?? '');
        const bName = (d.b_user_name as string | null) ?? null;
        // نام تصادفی مستقل — یکتا در همین دسته + غیربرابر با یوزرنیم پاسکال
        // خود کاربر (فضای ۳۳^۸؛ برخورد با بقیهٔ دیتابیس را ایندکس یونیک می‌گیرد)
        let next = generateUserName();
        while (used.has(next) || next === bName || next === oldName) next = generateUserName();
        used.add(next);
        userStatements.push({ q: { _id: { $oid: id } }, u: { $set: { user_name: next } } });
        // ردپای تحلیل کاتالوگ — آمار قدیمی با نام جدید ادامه پیدا می‌کند
        logStatements.push({
          q: { catalog_user_name: oldName },
          u: { $set: { catalog_user_name: next } },
          multi: true,
        });
      }
      const upRes = (await this.prisma.$runCommandRaw({
        update: 'User',
        updates: userStatements as unknown as Prisma.InputJsonObject[],
        ordered: false,
      })) as unknown as { nModified?: number; n?: number; writeErrors?: unknown[] };
      renamed = modCount(upRes);
      renameFailed = Number(upRes?.writeErrors?.length ?? 0);
      // ActivityLog جدا از User — خطایش بی‌اهمیت است (فقط آمار)
      await this.prisma
        .$runCommandRaw({
          update: 'ActivityLog',
          updates: logStatements as unknown as Prisma.InputJsonObject[],
          ordered: false,
        })
        .catch(() => undefined);
    }

    // باقی‌مانده پس از این دسته (شمارش با همان فیلتر)
    const remainingAgg = (await this.prisma.$runCommandRaw({
      aggregate: 'User',
      pipeline: [{ $match: renameFilter }, { $count: 'n' }],
      cursor: {},
    })) as unknown as { cursor?: { firstBatch?: { n?: number }[] } };
    const remaining = Number(remainingAgg?.cursor?.firstBatch?.[0]?.n ?? 0);

    const res = {
      renamedUserNames: renamed,
      renameFailed,
      remaining,
      done: remaining === 0 && renameFailed === 0,
      bVerifiedSet: modCount(setBFromVerified),
      verifiedCleared: modCount(clearVerified),
      approvedKept: approved.length,
    };
    this.logger.log(
      `fix-identity: renamed=${renamed} (failed=${renameFailed}), remaining=${remaining}, bVerified=${res.bVerifiedSet}, cleared=${res.verifiedCleared}, approvedKept=${res.approvedKept}`,
    );
    return res;
  }

  // ═══════════════════════════ حذف کامل کاربران ═══════════════════════════

  /**
   * حذف کامل انتخاب‌شده‌ها با همهٔ داده‌ها و بایت‌هایشان — ابزار پاک‌سازی
   * سالانهٔ کاربران بی‌activity (خواستهٔ مالک). حساب ادمین و نقش ADMIN
   * هرگز حذف نمی‌شوند. ترتیب حذف فرزندان عین cleanup ایمپورتر است (رفع
   * P2014 پرایسما روی مونگو).
   */
  async deleteUsers(adminPhone: string, ids: string[]) {
    this.assertAdmin(adminPhone);
    if (!Array.isArray(ids) || ids.length === 0) throw new BadRequestException('فهرست شناسه‌ها خالی است');
    if (ids.length > 500) throw new BadRequestException('هر بار حداکثر ۵۰۰ کاربر');

    const results: { id: string; userName?: string; ok: boolean; reason?: string }[] = [];
    for (const rawId of ids) {
      const id = String(rawId);
      try {
        if (!OID_RE.test(id)) throw new Error('شناسه نامعتبر');
        const user = await this.prisma.user.findUnique({
          where: { id },
          select: { id: true, userName: true, role: true, phone: true },
        });
        if (!user) throw new Error('کاربر پیدا نشد');
        if (user.role === 'ADMIN' || user.phone === importerAdminPhone()) {
          throw new Error('حساب ادمین قابل حذف نیست');
        }
        await this.deleteOneUserCascade(id, user.phone);
        results.push({ id, userName: user.userName, ok: true });
      } catch (err) {
        results.push({ id, ok: false, reason: (err as Error).message });
      }
    }
    const deleted = results.filter((r) => r.ok).length;
    this.logger.log(`deleteUsers: ${deleted}/${ids.length} deleted`);
    return { deleted, failed: results.length - deleted, results };
  }

  /** حذف تمام فرزندان یک کاربر + بایت‌های ذخیره‌سازی + خودش */
  private async deleteOneUserCascade(id: string, phone: string) {
    // شناسه‌های فرزند لازم برای پاک‌سازی صحیح
    const [productIds, threadIds, followItemIds, userCatalogIds, userBookIds, feedbackItemIds] =
      await Promise.all([
        this.prisma.product.findMany({ where: { userId: id }, select: { id: true } }),
        this.prisma.chatThread.findMany({
          where: { OR: [{ sellerId: id }, { buyerId: id }] },
          select: { id: true },
        }),
        this.prisma.followItem.findMany({ where: { userId: id }, select: { id: true } }),
        this.prisma.userCatalog.findMany({ where: { userId: id }, select: { id: true } }),
        this.prisma.userBuyerBook.findMany({ where: { userId: id }, select: { id: true } }),
        this.prisma.feedbackItem.findMany({ where: { userId: id }, select: { id: true } }),
      ]);
    const pIds = productIds.map((p) => p.id);
    const tIds = threadIds.map((t) => t.id);
    const fiIds = followItemIds.map((f) => f.id);
    const ucIds = userCatalogIds.map((c) => c.id);
    const ubIds = userBookIds.map((b) => b.id);
    const fbIds = feedbackItemIds.map((f) => f.id);

    // ۱) فرزندان آگهی‌ها → خود آگهی‌ها
    await this.prisma.ladderOrder.deleteMany({
      where: { OR: [{ userId: id }, ...(pIds.length ? [{ productId: { in: pIds } }] : [])] },
    });
    if (tIds.length) await this.prisma.chatMessage.deleteMany({ where: { threadId: { in: tIds } } });
    await this.prisma.chatThread.deleteMany({ where: { OR: [{ sellerId: id }, { buyerId: id }] } });
    await this.prisma.callLog.deleteMany({
      where: {
        OR: [
          { callerId: id },
          { calleeId: id },
          ...(pIds.length ? [{ productId: { in: pIds } }] : []),
        ],
      },
    });
    await this.prisma.productView.deleteMany({
      where: { OR: [{ viewerId: id }, ...(pIds.length ? [{ productId: { in: pIds } }] : [])] },
    });
    await this.prisma.productEditHistory.deleteMany({
      where: { OR: [{ userId: id }, ...(pIds.length ? [{ productId: { in: pIds } }] : [])] },
    });
    await this.prisma.favoriteProduct.deleteMany({
      where: { OR: [{ userId: id }, ...(pIds.length ? [{ productId: { in: pIds } }] : [])] },
    });
    await this.prisma.product.deleteMany({ where: { userId: id } });

    // ۲) فرزندان خود کاربر
    await this.prisma.file.deleteMany({ where: { ownerId: id } });
    await this.prisma.buyRequest.deleteMany({ where: { userId: id } });
    await this.prisma.contact.deleteMany({ where: { userId: id } });
    if (fiIds.length) await this.prisma.followNote.deleteMany({ where: { followItemId: { in: fiIds } } });
    await this.prisma.followItem.deleteMany({ where: { userId: id } });
    await this.prisma.followFolder.deleteMany({ where: { userId: id } });
    await this.prisma.favoriteSeller.deleteMany({ where: { OR: [{ userId: id }, { sellerId: id }] } });
    await this.prisma.sellerReview.deleteMany({ where: { OR: [{ sellerId: id }, { authorId: id }] } });
    await this.prisma.supplyOffer.deleteMany({ where: { OR: [{ sellerId: id }, { buyerId: id }] } });
    await this.prisma.serviceSignup.deleteMany({ where: { userId: id } });
    await this.prisma.buyerCategory.deleteMany({ where: { userId: id } });
    await this.prisma.savedCatalog.deleteMany({
      where: { OR: [{ userId: id }, ...(ucIds.length ? [{ catalogId: { in: ucIds } }] : [])] },
    });
    await this.prisma.userCatalog.deleteMany({ where: { userId: id } });
    await this.prisma.savedBuyerBook.deleteMany({
      where: { OR: [{ userId: id }, ...(ubIds.length ? [{ buyerBookId: { in: ubIds } }] : [])] },
    });
    await this.prisma.userBuyerBook.deleteMany({ where: { userId: id } });
    await this.prisma.verificationOrder.deleteMany({ where: { userId: id } });
    await this.prisma.chargeOrder.deleteMany({ where: { userId: id } });
    await this.prisma.packageOrder.deleteMany({ where: { userId: id } });
    await this.prisma.walletAdjustment.deleteMany({ where: { userId: id } });
    if (fbIds.length) await this.prisma.feedbackUpvote.deleteMany({ where: { itemId: { in: fbIds } } });
    await this.prisma.feedbackUpvote.deleteMany({ where: { userId: id } });
    await this.prisma.feedbackItem.deleteMany({ where: { userId: id } });
    await this.prisma.adminMessage.deleteMany({ where: { userId: id } });
    await this.prisma.supportMessage.deleteMany({ where: { userId: id } });
    await this.prisma.pushSubscription.deleteMany({ where: { userId: id } });
    await this.prisma.activityLog.deleteMany({ where: { userId: id } });
    await this.prisma.refreshToken.deleteMany({ where: { userId: id } });
    await this.prisma.otpCode.deleteMany({ where: { phone } });

    // ۳) خود کاربر
    await this.prisma.user.delete({ where: { id } });

    // ۴) بایت‌های ذخیره‌سازی — همهٔ عکس‌های این کاربر زیر users/{id}/ هستند
    //    (آواتار + گالری آگهی‌ها — خواستهٔ مالک ۱۳-۱۱)؛ بهترین‌حال
    try {
      await this.store.deletePrefix(`users/${id}/`);
    } catch {
      /* ردیف‌های DB منبع حقیقت‌اند؛ آبجکت یتیم بعداً جمع می‌شود */
    }
  }
}
