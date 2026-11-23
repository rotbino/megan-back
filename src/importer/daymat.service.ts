/**
 * مهاجرت دیمت → ایمچ (تسک ۳۵ — ۲۱-۱۱، خواستهٔ مالک):
 * «سایت دیمت تعطیل می‌شود؛ کاربرانش (به‌جز دو شمارهٔ خودم) با کالاها و
 * تصاویرشان به ایمچ بیایند تا از صفر کاتالوگ نسازند — فقط فیلدهای مفید،
 * هماهنگ با ساختار ایمچ؛ کاربران دیمت در دیتا ایمپورت قابل فیلتر باشند.»
 *
 * واقعیت‌های دیتای دیمت (کاوش ۲۱-۱۱):
 *   • دیتابیس روی همان کلاستر Atlas است (daymat_online_db) — مستقیم خوانده
 *     می‌شود؛ نیازی به منبع خارجی نیست.
 *   • آگهی = Ad (فعال ۱۷۶)؛ صاحب واقعی کاتالوگ «مالک بیزینس» است نه لزوماً
 *     سازندهٔ آگهی (ویزیتور می‌توانست برای بیزینس دیگری کالا بزند)؛
 *     مالک غایب/حذف‌شده → سازندهٔ معتبر؛ هیچ‌کدام نبود → رد.
 *   • دسته‌های آگهی‌ها (44 یکتا) همهٔ dangling اند (کالکشن دستهٔ دیمت عوض
 *     شده) — نام دستهٔ برگ از «title = نام‌دسته + نام‌کالا» استخراج و با
 *     جدول نگاشت سرپرستی‌شده به دستهٔ ایمچ می‌رسد؛ پنج دستهٔ سوپرمارکتی
 *     جدید زیر درخت موجود ساخته می‌شود (شناسهٔ رنج 2001+).
 *   • تصاویر روی همان حباب Arvan این پروژه‌اند (daymatfilles/users/<uid>/<file>)
 *     و عمومی خواندنی‌اند (95% پوشش؛ غایب‌ها مال کاربران مستثنی‌اند) —
 *     دانلود → UploadsService.ingestExternal یعنی «دقیقاً همان مسیر/
 *     پردازش/واترمارک آپلود عادی» (خواستهٔ مالک: مثل بقیهٔ کالاها).
 *
 * قواعد هویت (همراستا با تسک ۲۹):
 *   • userName ایمچ تصادفی و مستقل؛ isVerified هرگز true نمی‌شود (فقط مدارک)؛
 *   • رمز دیمت (bcrypt) قابل انتقال به scrypt نیست — خالی می‌ماند؛ کاربر با
 *     فلوی موبایل وارد می‌شود و بعداً رمز تعیین می‌کند.
 *   • شمارهٔ تکراری (قبلاً پاسکالی): کاربر جدید ساخته نمی‌شود؛ کالاها به
 *     همان حساب می‌چسبد و d (دادهٔ دیمت) ثبت می‌شود.
 *
 * idempotency: کاربر = شمارهٔ تلفن یا d.daymatUserId؛ آگهی = d.daymatAdId؛
 * تصویر = File.metadata.originalUrl. اجرای دوباره = ادامه/جایگزینی امن.
 */
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { uniqueUserName } from '../common/user-name';
import { UploadsService } from '../uploads/uploads.service';
import { importerAdminPhone } from './dto';

// ─── پیکربندی ───────────────────────────────────────────────────────────────

/** شماره‌هایی که مالک صریحاً از مهاجرت خارج کرد (خودش + ادمین دیمت) */
const EXCLUDED_PHONES = new Set(['09120000000', '09196421264']);

/** نام دیتابیس دیمت روی همان کلاستر — با env قابل تغییر */
function daymatDbName(): string {
  return process.env.DAYMAT_DB_NAME || 'daymat_online_db';
}

/** نام دیتابیس اصلی ایمچ — از مسیر DATABASE_URL استخراج می‌شود */
function imachDbName(): string {
  try {
    return new URL(process.env.DATABASE_URL || '').pathname.replace(/^\/+/, '') || 'megan_online_db';
  } catch {
    return 'megan_online_db';
  }
}

/** پایهٔ URL عمومی فایل‌های دیمت روی Arvan (تأییدشده با GET بدون اعتبارنه) */
function daymatFileBase(): string {
  const ep = (process.env.ARVAN_ENDPOINT || 'https://daymatfilles.s3.ir-thr-at1.arvanstorage.ir').replace(/\/+$/, '');
  return `${ep}/daymatfilles`;
}

/**
 * جدول نگاشت دستهٔ دیمت → دستهٔ برگ ایمچ (شمارهٔ id موجود).
 * کلید = categoryId دیمت (رشته). مقدار = شناسهٔ برگ مگان؛ با «keyword»
 * نگاشت درون‌دسته‌ای برای «سایر …». دسته‌های پدر در زمان اجرا از جدول
 * Category خوانده می‌شوند (برگ → پدرش).
 */
const CATEGORY_MAP: Record<string, { leaf: number; keyword?: Record<string, number> }> = {
  // ── نوشیدنی (78) ──
  cat_2012: { leaf: 106 }, // آبمیوه
  cat_2013: { leaf: 2001 }, // شربت (جدید)
  cat_2044: { leaf: 104 }, // نوشابه انرژی‌زا → نوشابه
  cat_2049: { leaf: 104 }, // سایر نوشیدنی گازدار
  cat_2019: { leaf: 2002 }, // سایر نوشیدنی بدون گاز (جدید)
  cat_1054: { leaf: 84 }, // پودر نوشیدنی (کاپوچینو) → قهوه
  // ── کنسرو و خانواده (81) ──
  cat_6011: { leaf: 93 }, // کنسرو مرغ و ماهی → تن ماهی
  cat_6012: { leaf: 135 }, // کنسرو حبوبات و سبزیجات
  cat_6015: { leaf: 135 }, // کنسرو میوه (کمپوت)
  cat_8012: { leaf: 2003 }, // شوریجات (جدید)
  cat_6013: { leaf: 92 }, // رب
  cat_109: { leaf: 92 }, // سایر کالای اساسی (رب قوطی)
  // ── «سایر» غذایی — نگاشت واژه‌ای روی نام کالا ──
  cat_1500: {
    leaf: 83, // پیش‌فرض: چای
    keyword: { چای: 83, مربا: 116, سویا: 127, اسپری: 902, حشره: 902 },
  },
  // ── ماکارونی (81) ──
  cat_1011: { leaf: 325 }, // پاستا و لازانیا
  cat_1013: { leaf: 325 }, // ماکارونی و اسپاگتی
  cat_1019: { leaf: 325 }, // سایر ماکارونی و رشته (نودل)
  // ── روغن (82) ──
  cat_1031: { leaf: 98 }, // روغن جامد
  cat_1032: { leaf: 98 }, // روغن مایع
  // ── برنج (غلات/کشاورزی) ──
  cat_1041: { leaf: 43 }, // برنج خارجی
  // ── تنقلات (80) ──
  cat_3099: { leaf: 117 }, // سایر اسنک و چیپس
  cat_3092: { leaf: 118 }, // اسنک و کرانچی → پفک
  cat_3109: { leaf: 124 }, // سایر بیسکویت و ویفر
  cat_1409: { leaf: 124 }, // سایر فله (بیسکویت فله)
  cat_3019: { leaf: 122 }, // سایر پاستیل و ژله
  cat_3041: { leaf: 121 }, // شکلات
  cat_3051: { leaf: 123 }, // کیک → کیک و کلوچه
  cat_3062: { leaf: 119 }, // لواشک
  cat_11012: { leaf: 2004 }, // غلات صبحانه (جدید)
  // ── بهداشتی (1004) ──
  cat_5021: { leaf: 2005 }, // بهداشت دهان و دندان (جدید)
  cat_5022: { leaf: 1033 }, // بهداشت سر و بدن (شامپو) → محصولات مو
  cat_5029: { leaf: 1035 }, // سایر بهداشت فردی → بهداشت شخصی
  cat_5025: { leaf: 902 }, // وسایل بهداشتی (محصولاتش ظرفشویی است) → مواد شوینده
  // ── شوینده (887) ──
  cat_7012: { leaf: 902 }, // پاک کننده سطوح
  cat_7014: { leaf: 902 }, // سفید کننده و ضدعفونی
  cat_7022: { leaf: 902 }, // مایعات ظرفشویی
  cat_7029: { leaf: 902 }, // سایر شوینده ظروف
  cat_7033: { leaf: 902 }, // مایع شوینده منسوجات
  // ── سرگرمی (1003) ──
  cat_10013: { leaf: 1031 }, // سرگرمی → بازی سرگرمی
  // ── دسته‌های ObjectId قدیمی دیمت (نام دسته در دیتا نبود) ──
  '6a78d22172aee4631016918e': { leaf: 752 }, // بلوک هبلکس → بلوک
  '6a78d22172aee46310169186': { leaf: 746 }, // اجر قرمز → آجر
  '6a7ece2b4aa09a5768b7fb89': { leaf: 951 }, // دستبند طلا → زیورآلات
  '6a78d21572aee4631016899d': { leaf: 105 }, // خیار شور
  '6a78d21572aee46310168987': { leaf: 93 }, // تن ماهی فلفلی → تن ماهی
  '6a78d21572aee46310168981': { leaf: 92 }, // رب ۷۰۰ شیشه → رب
};

/** دسته‌های جدید ایمچ که مهاجرت در صورت نبود می‌سازد — رنج 2001+ (مکس موجود 1092) */
const NEW_CATEGORIES: { id: number; name: string; slug: string; parent: number }[] = [
  { id: 2001, name: 'شربت', slug: 'sharbat', parent: 78 },
  { id: 2002, name: 'نوشیدنی بدون گاز', slug: 'nooshidani-bi-gazdar', parent: 78 },
  { id: 2003, name: 'شوریجات', slug: 'shurijat', parent: 81 },
  { id: 2004, name: 'غلات صبحانه', slug: 'ghalat-sobhane', parent: 80 },
  { id: 2005, name: 'بهداشت دهان و دندان', slug: 'behdasht-dahan-dandan', parent: 1004 },
];

// ─── تایپ‌های دیمت (فقط فیلدهای مصرفی) ─────────────────────────────────────

interface DmUser {
  _id: { toString(): string };
  phone: string;
  fullName?: string;
  gender?: string | null;
  status?: string;
  membershipTier?: string;
  isPhoneVerified?: boolean;
  bio?: string;
  email?: string;
  createdAt?: Date;
  provinceCode?: string;
  cityCode?: string;
}

interface DmBusiness {
  _id: { toString(): string };
  ownerUserId: { toString(): string };
  name: string;
  shortDescription?: string;
  description?: string;
  type?: string;
  provinceCode?: string;
  cityCode?: string;
  phone?: string;
  logoUrl?: string | null; // شناسهٔ File دیمت
}

interface DmAd {
  _id: { toString(): string };
  businessId?: { toString(): string } | null;
  createdByUserId?: { toString(): string } | null;
  categoryId?: string;
  title: string;
  productType?: string;
  description?: string;
  unitId?: { toString(): string } | null;
  unitBaseTitle?: string;
  unitQty?: number | null;
  unitPrice?: number;
  singleUnitPrice?: number | null;
  consumerPrice?: number | null;
  minQuantity?: number;
  availableQuantity?: number;
  provinceCode?: string;
  cityCode?: string;
  createdAt?: Date;
  updatedAt?: Date;
  status?: string;
}

interface DmFile {
  _id: { toString(): string };
  userId: { toString(): string };
  relatedModel?: string;
  relatedId?: { toString(): string } | null;
  fieldKey?: string;
  name?: string;
  mimeType?: string;
  path?: string; // مسیر ویندوزی — فقط نام فایل لازم است
  createdAt?: Date;
}

// ─── تایپ‌های جاب ────────────────────────────────────────────────────────────

export interface DaymatJobProgress {
  phase: 'prepare' | 'users' | 'categories' | 'products' | 'images' | 'done' | 'error';
  phaseLabel: string;
  log: { t: string; msg: string; level: 'info' | 'success' | 'warn' | 'error' }[];
  counters: Record<string, number>;
  /** آگهی‌های ردشده با دلیل — برای گزارش شفاف به مالک */
  skippedAds: { title: string; reason: string }[];
  errors: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

// ─── سرویس ──────────────────────────────────────────────────────────────────

@Injectable()
export class DaymatService {
  private readonly logger = new Logger(DaymatService.name);
  private running = false;
  private job: DaymatJobProgress | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  /** گارد عملیات سنگین — مثل بقیهٔ ایمپورتر (IMPORTER_ADMIN_PHONE) */
  private assertAdmin(adminPhone: string): void {
    if (adminPhone !== importerAdminPhone()) {
      throw new ForbiddenException('این عملیات فقط برای حساب ادمین در دسترس است');
    }
  }

  /** آیا مهاجرتی در جریان است؟ (جاب تکی — مثل ماژول بک‌آپ) */
  get busy(): boolean {
    return this.running;
  }

  // ═══════════════════════ پیش‌نمایش (بدون نوشتن) ═══════════════════════

  async status(): Promise<Record<string, unknown>> {
    const client = new MongoClient(process.env.DATABASE_URL || '', {
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 5,
    });
    try {
      await client.connect();
      const ddb = client.db(daymatDbName());

      const [users, activeAds, adFiles, avatarFiles, logoFiles] = await Promise.all([
        ddb.collection('User').find({}).toArray() as unknown as Promise<DmUser[]>,
        ddb.collection('Ad').countDocuments({ status: 'active' }),
        ddb.collection('File').countDocuments({ relatedModel: 'Ad', relatedId: { $ne: null } }),
        ddb.collection('File').countDocuments({ relatedModel: 'User', relatedId: { $ne: null }, fieldKey: 'avatar' }),
        ddb.collection('File').countDocuments({ relatedModel: 'Business', relatedId: { $ne: null }, fieldKey: 'logo' }),
      ]);

      const excluded = users.filter((u) => EXCLUDED_PHONES.has(u.phone)).length;
      const phones = users.filter((u) => !EXCLUDED_PHONES.has(u.phone)).map((u) => u.phone);

      // شماره‌های تکراری در ایمچ (به آن حساب می‌چسبند)
      const existing = await this.prisma.user.count({ where: { phone: { in: phones } } });
      // قبلاً مهاجرت‌شده‌ها
      const already = await this.prisma.user.count({ where: { importSource: 'daymat' } });

      return {
        daymatDb: daymatDbName(),
        users: { total: users.length, excluded, toImport: phones.length, alreadyInImach: already, phoneExistsInImach: existing },
        ads: { active: activeAds },
        images: { adImages: adFiles, avatars: avatarFiles, businessLogos: logoFiles },
        busy: this.running,
        excludedPhones: [...EXCLUDED_PHONES],
        note: 'پیش‌نمایش فقط-خواندنی است؛ اجرا با run شروع می‌شود.',
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  // ═══════════════════════ اجرای مهاجرت ═══════════════════════

  async run(adminPhone: string): Promise<{ started: boolean; alreadyRunning: boolean }> {
    this.assertAdmin(adminPhone);
    if (this.running) return { started: false, alreadyRunning: true };
    this.running = true;
    this.job = {
      phase: 'prepare',
      phaseLabel: 'آماده‌سازی',
      log: [],
      counters: {},
      skippedAds: [],
      errors: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    void this.execute().catch((err: unknown) => {
      this.log('error', `شکست کلی مهاجرت: ${String((err as Error)?.message ?? err).slice(0, 300)}`);
      if (this.job) {
        this.job.phase = 'error';
        this.job.finishedAt = new Date().toISOString();
      }
    }).finally(() => {
      this.running = false;
      if (this.job && this.job.phase !== 'error') {
        this.job.phase = 'done';
        this.job.finishedAt = new Date().toISOString();
      }
    });
    return { started: true, alreadyRunning: false };
  }

  progress(): DaymatJobProgress | null {
    return this.job;
  }

  // ─── هستهٔ اجرا ──────────────────────────────────────────────────────────

  private async execute(): Promise<void> {
    const client = new MongoClient(process.env.DATABASE_URL || '', {
      serverSelectionTimeoutMS: 15_000,
      maxPoolSize: 10,
    });
    await client.connect();
    try {
      const ddb = client.db(daymatDbName());
      const mdb = client.db(imachDbName());

      // ── فاز ۰: بک‌فیل منبع پاسکال (یک‌بار؛ idempotent) ──
      // کوئری خام: فیلتر null پریمیا با فیلدِ غایب در مونگو مطابق نمی‌شود
      // (درس اجرای اول: ۰ ردیف با updateMany پریمیا) — درایور خام مستقیم.
      const backfill = await mdb.collection('User').updateMany(
        { b_user_name: { $ne: null }, import_source: { $in: [null] } },
        { $set: { import_source: 'pascal' } },
      );
      this.log('info', `بک‌فیل منبع: ${backfill.modifiedCount} کاربر پاسکالی برچسب «pascal» گرفتند`);

      // ── فاز ۱: کاربران ──
      this.setPhase('users', 'کاربران دیمت');
      const dmUsers = (await ddb.collection('User').find({}).toArray()) as unknown as DmUser[];
      const dmBusinesses = (await ddb.collection('Business').find({}).toArray()) as unknown as DmBusiness[];
      const bizByOwner = new Map<string, DmBusiness[]>();
      for (const b of dmBusinesses) {
        const k = String(b.ownerUserId);
        if (!bizByOwner.has(k)) bizByOwner.set(k, []);
        bizByOwner.get(k)!.push(b);
      }

      // کاربران دائمِ مجاز: id دیمت → رکورد ایمچ
      const imachByDmId = new Map<string, { id: string; isNew: boolean }>();
      const dmById = new Map<string, DmUser>();
      for (const u of dmUsers) {
        const dmId = String(u._id);
        dmById.set(dmId, u);
        if (EXCLUDED_PHONES.has(u.phone)) {
          this.bump('usersExcluded');
          continue;
        }
        const rec = await this.importUser(u, bizByOwner.get(dmId)?.[0]);
        if (rec) imachByDmId.set(dmId, rec);
      }
      this.log(
        'success',
        `کاربران: ${imachByDmId.size} آماده (${this.counters['usersCreated'] ?? 0} تازه، ${
          this.counters['usersAttached'] ?? 0
        } چسبیده به حساب موجود) — ${this.counters['usersExcluded'] ?? 0} مستثنی (شمارهٔ خودتان)`,
      );

      // ── فاز ۲: دسته‌ها ──
      this.setPhase('categories', 'دسته‌بندی‌ها');
      const catById = new Map<number, { parentId: number | null }>();
      for (const c of await this.prisma.category.findMany({ select: { id: true, parentId: true } })) {
        catById.set(c.id, { parentId: c.parentId });
      }
      for (const nc of NEW_CATEGORIES) {
        if (catById.has(nc.id)) continue;
        await this.prisma.category
          .create({ data: { id: nc.id, parentId: nc.parent, categoryName: nc.name, slug: nc.slug } })
          .catch(() => undefined); // رقابت — قبلاً ساخته شده
        catById.set(nc.id, { parentId: nc.parent });
        this.bump('categoriesCreated');
        this.log('info', `دستهٔ جدید «${nc.name}» زیر دستهٔ ${nc.parent} ساخته شد`);
      }

      // ── فاز ۳: آگهی‌ها ──
      this.setPhase('products', 'کالاهای دیمت');
      const dmAds = (await ddb
        .collection('Ad')
        .find({ status: 'active' })
        .sort({ createdAt: 1 })
        .toArray()) as unknown as DmAd[];
      const dmUnits = new Map<string, string>();
      for (const u of (await ddb.collection('Unit').find({}).toArray()) as unknown as {
        _id: { toString(): string };
        title: string;
      }[]) {
        dmUnits.set(String(u._id), u.title);
      }
      // فایل‌های تصویر آگهی — گروه‌بندی بر آگهی
      const dmFiles = (await ddb
        .collection('File')
        .find({ relatedModel: 'Ad', relatedId: { $ne: null } })
        .toArray()) as unknown as DmFile[];
      const filesByAd = new Map<string, DmFile[]>();
      for (const f of dmFiles) {
        const k = String(f.relatedId);
        if (!filesByAd.has(k)) filesByAd.set(k, []);
        filesByAd.get(k)!.push(f);
      }
      for (const list of filesByAd.values()) {
        list.sort((a, b) => String(a.fieldKey ?? '').localeCompare(String(b.fieldKey ?? ''), undefined, { numeric: true }));
      }

      // آواتار/لوگو برای فاز تصاویر
      const dmAvatars = (await ddb
        .collection('File')
        .find({ relatedModel: 'User', relatedId: { $ne: null }, fieldKey: 'avatar' })
        .toArray()) as unknown as DmFile[];
      const avatarByDmUser = new Map<string, DmFile>();
      for (const f of dmAvatars) avatarByDmUser.set(String(f.relatedId), f);
      const logoByBiz = new Map<string, DmFile>();
      for (const f of (await ddb
        .collection('File')
        .find({ relatedModel: 'Business', relatedId: { $ne: null }, fieldKey: 'logo' })
        .toArray()) as unknown as DmFile[]) {
        logoByBiz.set(String(f.relatedId), f);
      }

      // نگاشت شهر دیمت → id شهر ایمچ (بر پایهٔ نام — کدهای دو سیستم فرق دارند)
      const dmCityByCode = new Map<string, string>();
      for (const l of (await ddb
        .collection('Location')
        .find({ type: 'city' })
        .toArray()) as unknown as { cityCode?: string; title?: string }[]) {
        if (l.cityCode) dmCityByCode.set(l.cityCode, l.title ?? '');
      }
      const imachCityByName = new Map<string, number>();
      for (const l of await this.prisma.location.findMany({ where: { type: 'city' }, select: { name: true, pascalId: true } })) {
        imachCityByName.set(l.name.trim(), l.pascalId);
      }
      const resolveCity = (ad: DmAd): number => {
        const name = dmCityByCode.get(String(ad.cityCode ?? '')) ?? '';
        return imachCityByName.get(name.trim()) ?? 427; // پیش‌فرض همدان (همهٔ آگهی‌ها همدان‌اند)
      };

      // رزرو شناسه‌های تازه از Counter — همه یکجا برای پرهیز از تداخل
      await this.ensureProductCounter();

      type Planned = {
        ad: DmAd;
        ownerDmId: string;
        imachUserId: string;
        files: DmFile[];
        biz?: DmBusiness;
      };
      const planned: Planned[] = [];

      for (const ad of dmAds) {
        const title = (ad.title ?? '').trim();
        // مالک: صاحب بیزینس → سازنده؛ هر دو غایب/مستثنی → رد
        const biz = dmBusinesses.find((b) => String(b._id) === String(ad.businessId ?? ''));
        const bizOwner = biz ? dmById.get(String(biz.ownerUserId)) : undefined;
        const creator = dmById.get(String(ad.createdByUserId ?? ''));

        let ownerDmId: string | null = null;
        let reason = '';
        if (bizOwner && !EXCLUDED_PHONES.has(bizOwner.phone)) ownerDmId = String(bizOwner._id);
        else if (bizOwner) reason = 'مالک بیزینس از شماره‌های مستثنی است';
        else if (creator && !EXCLUDED_PHONES.has(creator.phone)) ownerDmId = String(creator._id);
        else if (creator) reason = 'سازندهٔ آگهی از شماره‌های مستثنی است';
        else reason = 'نه بیزینس معتبر دارد نه سازندهٔ در دسترس';

        const imach = ownerDmId ? imachByDmId.get(ownerDmId) : undefined;
        if (!ownerDmId || !imach) {
          this.job?.skippedAds.push({ title: title || 'بدون عنوان', reason });
          this.bump('adsSkipped');
          continue;
        }
        planned.push({ ad, ownerDmId, imachUserId: imach.id, files: filesByAd.get(String(ad._id)) ?? [], biz });
      }

      // ایجاد/به‌روزرسانی محصولات — idempotency با d.daymatAdId (کوئری خام؛
      // این نسخهٔ Prisma فیلتر مسیر JSON ندارد)
      const pidByAd = new Map<string, number>();
      for (const p of planned) {
        const dmAdId = String(p.ad._id);
        const existing = await mdb
          .collection('Product')
          .findOne({ 'd.daymatAdId': dmAdId }, { projection: { _id: 1 } });
        if (existing) {
          pidByAd.set(dmAdId, Number(existing._id));
          this.bump('productsAlready');
          continue;
        }
        try {
          const pid = await this.nextProductId();
          const data = await this.buildProductData(p.ad, p.imachUserId, pid, catById, dmUnits, resolveCity);
          await this.prisma.product.create({ data });
          pidByAd.set(dmAdId, pid);
          this.bump('productsCreated');
        } catch (err) {
          this.bump('productsFailed');
          this.job?.errors.push(`آگهی «${(p.ad.title ?? '').slice(0, 60)}»: ${String((err as Error)?.message ?? err).slice(0, 140)}`);
        }
      }
      this.log(
        'success',
        `کالاها: ${this.counters['productsCreated'] ?? 0} ساخته شد، ${this.counters['productsAlready'] ?? 0} قبلاً بود، ${
          this.job?.skippedAds.length ?? 0
        } رد شد (مالک مستثنی/غایب)، ${this.counters['productsFailed'] ?? 0} خطا`,
      );

      // ── فاز ۴: تصاویر ──
      this.setPhase('images', 'تصاویر');
      type ImgTask =
        | { kind: 'product'; pid: number; file: DmFile; userId: string }
        | { kind: 'avatar'; file: DmFile; userId: string }
        | { kind: 'logo'; file: DmFile; userId: string };
      const tasks: ImgTask[] = [];

      for (const p of planned) {
        const pid = pidByAd.get(String(p.ad._id));
        if (!pid) continue;
        for (const f of p.files) tasks.push({ kind: 'product', pid, file: f, userId: p.imachUserId });
      }
      for (const [dmUserId, imach] of imachByDmId) {
        const av = avatarByDmUser.get(dmUserId);
        if (av) tasks.push({ kind: 'avatar', file: av, userId: imach.id });
        const biz = bizByOwner.get(dmUserId)?.[0];
        const logo = biz ? logoByBiz.get(String(biz._id)) : undefined;
        if (logo) tasks.push({ kind: 'logo', file: logo, userId: imach.id });
      }

      let done = 0;
      const POOL = 6;
      for (let i = 0; i < tasks.length; i += POOL) {
        const chunk = tasks.slice(i, i + POOL);
        await Promise.all(chunk.map((t) => this.ingestImage(t).then((ok) => { if (ok) done++; })));
      }
      this.log(
        'success',
        `تصاویر: ${done} منتقل شد (${this.counters['imagesFailed'] ?? 0} ناموفق، ${this.counters['imagesAlready'] ?? 0} قبلاً بود) — همان مسیر/واترمارک آپلود عادی`,
      );

      // ── جمع‌بندی ──
      const [uCount, pCount] = await Promise.all([
        mdb.collection('User').countDocuments({ import_source: 'daymat' }),
        mdb.collection('Product').countDocuments({ 'd.source': 'daymat' }),
      ]);
      this.log('success', `راستی‌آزمایی نهایی: ${uCount} کاربر و ${pCount} کالای دیمتی در ایمچ ثبت‌اند`);
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  // ─── کاربر ──────────────────────────────────────────────────────────────

  private async importUser(
    dm: DmUser,
    biz?: DmBusiness,
  ): Promise<{ id: string; isNew: boolean } | null> {
    const dmId = String(dm._id);
    try {
      const tokens = (dm.fullName ?? '').trim().split(/\s+/).filter(Boolean);
      const firstName = tokens.length > 1 ? tokens[0] : (tokens[0] ?? '');
      const lastName = tokens.length > 1 ? tokens.slice(1).join(' ') : '';
      const sex = dm.gender === 'male' ? 'آقا' : dm.gender === 'female' ? 'خانم' : null;

      const dData = {
        source: 'daymat',
        daymatUserId: dmId,
        businessId: biz ? String(biz._id) : null,
        businessName: biz?.name ?? null,
        membershipTier: dm.membershipTier ?? null,
        isPhoneVerified: dm.isPhoneVerified === true,
        bio: dm.bio ?? null,
        email: dm.email ?? null,
        daymatCreatedAt: dm.createdAt instanceof Date ? dm.createdAt.toISOString() : null,
        importedAt: new Date().toISOString(),
      };

      // استان همدان (30) — همهٔ فعالیت دیمت همین استان بود؛ شهر از بیزینس/پیش‌فرض
      const existing = await this.prisma.user.findFirst({
        where: { phone: dm.phone },
        select: { id: true, profile: true, importSource: true, d: true },
      });

      if (existing) {
        // حساب موجود (مثلاً پاسکالی) — کالاها به همین حساب می‌چسبند؛ پروفایل
        // دیمت فقط جاهای خالی را پر می‌کند و منبعِ قبلی دست نمی‌خورد
        const profile = (existing.profile ?? {}) as Record<string, unknown>;
        await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            d: dData,
            importSource: existing.importSource ?? 'daymat',
            provinceId: 30,
            profile: {
              ...profile,
              ...(profile.companyName ? {} : biz?.name ? { companyName: biz.name } : {}),
              ...(profile.isCompany !== undefined ? {} : biz ? { isCompany: true } : {}),
            } as object,
          },
        });
        this.bump('usersAttached');
        return { id: existing.id, isNew: false };
      }

      const user = await this.prisma.user.create({
        data: {
          phone: dm.phone,
          userName: await uniqueUserName(this.prisma),
          firstName,
          lastName,
          ...(sex ? { sex } : {}),
          role: 'USER',
          isSeller: true,
          isBuyer: true,
          provinceId: 30,
          importSource: 'daymat',
          d: dData,
          ...(biz?.description?.trim() || biz?.shortDescription?.trim()
            ? { businessDesc: (biz.description ?? biz.shortDescription ?? '').trim() }
            : {}),
          ...(biz
            ? {
                profile: {
                  isCompany: true,
                  companyName: biz.name,
                  activityDomain: biz.type ?? null,
                } as object,
              }
            : {}),
          createdAt: dm.createdAt instanceof Date ? dm.createdAt : new Date(),
        },
      });
      this.bump('usersCreated');
      return { id: user.id, isNew: true };
    } catch (err) {
      this.bump('usersFailed');
      this.job?.errors.push(`کاربر ${dm.phone}: ${String((err as Error)?.message ?? err).slice(0, 140)}`);
      return null;
    }
  }

  // ─── محصول ──────────────────────────────────────────────────────────────

  private async buildProductData(
    ad: DmAd,
    userId: string,
    pid: number,
    catById: Map<number, { parentId: number | null }>,
    dmUnits: Map<string, string>,
    resolveCity: (ad: DmAd) => number,
  ): Promise<Prisma.ProductCreateInput> {
    // نام کالا: productType تمیز است (title پیشوند نام دسته را دارد)
    const name = ((ad.productType ?? '').trim() || (ad.title ?? '').trim()).slice(0, 180);
    const desc = (ad.description ?? '').trim();

    // دستهٔ برگ: جدول نگاشت (+ واژه‌ای برای «سایر»)؛ پدر از جدول
    let leaf = CATEGORY_MAP[String(ad.categoryId ?? '')]?.leaf ?? 40 /* سایر */;
    const kwMap = CATEGORY_MAP[String(ad.categoryId ?? '')]?.keyword;
    if (kwMap) {
      for (const [kw, id] of Object.entries(kwMap)) {
        if (name.includes(kw)) {
          leaf = id;
          break;
        }
      }
    }
    const parent = catById.get(leaf)?.parentId ?? 77; // والدِ برگ؛ غایب → فرآورده‌های غذایی

    const unit = dmUnits.get(String(ad.unitId ?? '')) ?? ((ad.unitBaseTitle ?? '').trim() || 'عدد');

    // ویژگی‌های مکمل دیمت که معادل ستونی در ایمچ ندارند
    const features: { key: string; value: string }[] = [];
    if (ad.singleUnitPrice && ad.singleUnitPrice > 0) features.push({ key: 'قیمت تک‌فروشی', value: `${ad.singleUnitPrice.toLocaleString('fa-IR')} تومان` });
    if (ad.consumerPrice && ad.consumerPrice > 0) features.push({ key: 'قیمت مصرف‌کننده', value: `${ad.consumerPrice.toLocaleString('fa-IR')} تومان` });
    if (ad.unitQty && ad.unitQty > 0) features.push({ key: 'تعداد در بسته', value: String(ad.unitQty) });

    const adAny = ad as unknown as { priceHistory?: { updatedAt?: Date }[] };
    const priceHistory = Array.isArray(adAny.priceHistory) ? adAny.priceHistory : [];
    const lastPriceAt = priceHistory.length ? priceHistory[priceHistory.length - 1].updatedAt : undefined;
    const priceUpdatedAt =
      (lastPriceAt instanceof Date ? lastPriceAt : undefined) ?? (ad.updatedAt instanceof Date ? ad.updatedAt : new Date());

    return {
      id: pid,
      productName: name || 'کالای دیمت',
      slug: `فروش-عمده-${name || 'کالا'}-${pid}`.slice(0, 190),
      description: desc,
      categoryId: parent,
      subCategoryId: leaf,
      unit,
      provinceId: 30,
      cityId: resolveCity(ad),
      stock: ad.availableQuantity ?? 0,
      minSaleAmount: ad.minQuantity ?? 0,
      minSalePrice: ad.unitPrice ?? 0,
      priceValidityDays: 3650,
      priceUpdatedAt,
      ...(features.length ? { features: features as unknown as Prisma.InputJsonValue } : {}),
      status: 'confirmed',
      user: { connect: { id: userId } },
      d: {
        source: 'daymat',
        daymatAdId: String(ad._id),
        daymatBusinessId: ad.businessId ? String(ad.businessId) : null,
        daymatUserId: ad.createdByUserId ? String(ad.createdByUserId) : null,
        title: (ad.title ?? '').slice(0, 200),
      } as unknown as Prisma.InputJsonValue,
      createdAt: ad.createdAt instanceof Date ? ad.createdAt : new Date(),
      updatedAt: ad.updatedAt instanceof Date ? ad.updatedAt : new Date(),
    };
  }

  /** Counter('product') — مثل الگوی seed؛ idهای تازه اتمیک بالا می‌روند */
  private async ensureProductCounter(): Promise<void> {
    const cur = await this.prisma.counter.findUnique({ where: { id: 'product' } });
    if (!cur) {
      const max = await this.prisma.product.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
      await this.prisma.counter
        .upsert({ where: { id: 'product' }, update: {}, create: { id: 'product', seq: (max?.id ?? 0) + 1000 } })
        .catch(() => undefined);
    }
  }

  private async nextProductId(): Promise<number> {
    const c = await this.prisma.counter.update({
      where: { id: 'product' },
      data: { seq: { increment: 1 } },
    });
    return c.seq;
  }

  // ─── تصاویر ─────────────────────────────────────────────────────────────

  /** URL عمومی فایل دیمت روی Arvan — الگوی تأییدشده با GET بدون اعتبارنه */
  private daymatFileUrl(f: DmFile): string {
    const base = String(f.path ?? '').split(/[\\/]/).pop() ?? '';
    return `${daymatFileBase()}/users/${String(f.userId)}/${encodeURIComponent(base)}`;
  }

  private async ingestImage(
    t: { kind: 'product' | 'avatar' | 'logo'; pid?: number; file: DmFile; userId: string },
  ): Promise<boolean> {
    const url = this.daymatFileUrl(t.file);
    const isAvatar = t.kind === 'avatar';
    const model = t.kind === 'product' ? 'Product' : 'User';
    const modelId = t.kind === 'product' ? String(t.pid) : t.userId;
    const fieldKey = t.kind === 'logo' ? 'gallery' : t.kind === 'avatar' ? 'avatar' : 'gallery';

    // idempotency — این URL قبلاً به این اسلات منتقل شده؟ (کوئری خام — این
    // نسخهٔ Prisma فیلتر مسیر JSON ندارد؛ نام فیلدها = @map اسکیما)
    const existing = await this.prisma.$runCommandRaw({
      find: 'File',
      filter: {
        related_model: model,
        related_id: modelId,
        field_key: fieldKey,
        'metadata.originalUrl': url,
      },
      limit: 1,
      projection: { _id: 1 },
    });
    const firstBatch = (existing as unknown as { cursor?: { firstBatch?: unknown[] } })?.cursor?.firstBatch ?? [];
    if (firstBatch.length > 0) {
      this.bump('imagesAlready');
      return true;
    }

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(25_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      const mime = t.file.mimeType || resp.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
      const res = await this.uploads.ingestExternal({
        ownerId: t.userId,
        model: model as 'Product' | 'User',
        modelId,
        fieldKey,
        buffer: buf,
        mimetype: mime,
        filename: t.file.name ?? url.split('/').pop() ?? 'daymat',
        replace: isAvatar, // اسلات تک‌فایلی آواتار؛ گالری چندفایلی
        metadata: { importedFrom: 'daymat', originalUrl: url },
        // تصاویر دیمت واترمارک پاسکال ندارند — بررسی‌شده و تمیز
        ...(t.kind === 'product' ? { watermarkOutcome: 'not_found' as const } : {}),
      });
      if (res.ok) {
        this.bump('imagesDone');
        return true;
      }
      this.bump('imagesFailed');
      this.job?.errors.push(`تصویر ${url.split('/').pop()} رد شد (${res.reason})`);
      return false;
    } catch (err) {
      this.bump('imagesFailed');
      this.job?.errors.push(`تصویر ${url.split('/').pop()}: ${String((err as Error)?.message ?? err).slice(0, 100)}`);
      return false;
    }
  }

  // ─── ابزار جاب ──────────────────────────────────────────────────────────

  private setPhase(phase: DaymatJobProgress['phase'], label: string): void {
    if (!this.job) return;
    this.job.phase = phase;
    this.job.phaseLabel = label;
    this.log('info', `── ${label} ──`);
  }

  private log(level: DaymatJobProgress['log'][number]['level'], msg: string): void {
    this.job?.log.push({ t: new Date().toISOString(), msg, level });
    if (this.job && this.job.log.length > 400) this.job.log.splice(0, this.job.log.length - 400);
    if (level === 'error') this.logger.error(msg);
  }

  private get counters(): Record<string, number> {
    return this.job?.counters ?? {};
  }

  private bump(key: string, by = 1): void {
    if (!this.job) return;
    this.job.counters[key] = (this.job.counters[key] ?? 0) + by;
  }
}
