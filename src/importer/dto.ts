import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** گوشهٔ امن ایمپورتر — فقط این شمارهٔ ادمین اجازهٔ عملیات مخرب دارد */
export const importerAdminPhone = () =>
  (process.env.IMPORTER_ADMIN_PHONE ?? '09196421264').trim();

export class CleanupDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;
}

export class SingleImportDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;

  @IsString()
  @Length(2, 64)
  userName!: string;

  @IsOptional()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل باید مثل 09123456789 باشد' })
  phone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500, {
    message: 'حداکثر آگهی هر ایمپورت تک‌کاربره ۵۰۰ است — برای همه، خالی بگذارید',
  })
  maxProducts?: number;
}

export class ListImportDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;

  /** @Type(() => Number) — ورودی رشته‌ای (تست با curl/سواگر) هم پذیرفته می‌شود */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  /** @Type(() => Number) — ورودی رشته‌ای (تست با curl/سواگر) هم پذیرفته می‌شود */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // سقف قبلی ۲۰۰ بود (خواستهٔ مالک ۱۵-۱۱: «۱۰۰۰ و ۱۰۰۰۰ هم قبول کن») — حالا
  // هر عددی تا ۱۰۰٬۰۰۰ مجاز است؛ سرویس خودش در قطعه‌های ۲۰۰تایی پشت‌سرهم
  // اجرا می‌کند و به انتهای منبع که برسد زودتر تمام می‌شود.
  @Max(100000, { message: 'تعداد کاربر باید بین ۱ تا ۱۰۰٬۰۰۰ باشد' })
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500, { message: 'حداکثر آگهی هر کاربر ۵۰۰ است — برای همه، ۰ بگذارید' })
  maxProductsPerUser?: number;
}

export class StopJobDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;
}

/** POST /importer/jobs/:id/pause و :id/resume — توقف موقت/ادامهٔ جاب
 *  (خواستهٔ مالک ۱۶-۱۱: «هر موقع خواستم پالز کنم یا پلی کنم») */
export class PauseJobDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;
}

// ─── مدیریت کاربران ایمپورت‌شده (بخش «دیتا ایمپورت») ────────────────────────────

/** GET /importer/users — فیلتر/سورت/صفحه‌بندی جدول مدیریت */
export class ImportedUsersQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  q?: string;

  @IsOptional()
  @IsIn(['buskool', 'native', 'stub', 'daymat', 'all'])
  source?: 'buskool' | 'native' | 'stub' | 'daymat' | 'all';

  /** ویژهٔ پاسکال (b.premium.isPremium) — نه اعتبار آیمچ */
  @IsOptional()
  @IsIn(['yes', 'no'])
  premium?: 'yes' | 'no';

  /** نوع بستهٔ پاسکال: 0=رایگان ۱=دوماهه ۲=شش‌ماهه ۳=یک‌ساله */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3)
  packageType?: number;

  /** رفتار ورود: ever / never / بعد از تماس (after-contact) */
  @IsOptional()
  @IsIn(['ever', 'never', 'after-contact'])
  login?: 'ever' | 'never' | 'after-contact';

  @IsOptional()
  @IsIn(['yes', 'no'])
  contacted?: 'yes' | 'no';

  @IsOptional()
  @IsIn(['yes', 'no'])
  failed?: 'yes' | 'no';

  /** (۱۹-۱۱) ایمپورت از وب با دست خود کاربر — جلسهٔ WebImportSession کامل‌شده */
  @IsOptional()
  @IsIn(['yes', 'no'])
  selfImport?: 'yes' | 'no';

  /** «رهاشده»: هرگز وارد نشده + بیش از N روز از ایمپورت گذشته */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  staleDays?: number;

  /** بازهٔ تاریخ ثبت‌نام (created_at) — ISO میلادی؛ هر طرف مستقل اختیاری */
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  @IsOptional()
  @IsIn(['lastLogin', 'createdAt', 'products', 'pascalCreated', 'imported', 'contacted'])
  sort?: 'lastLogin' | 'createdAt' | 'products' | 'pascalCreated' | 'imported' | 'contacted';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(100)
  pageSize?: number;
}

/** POST /importer/users/:id/contact — علامت تماس/دعوت (CRM) */
export class MarkContactDto {
  /** true = برداشتن علامت */
  @IsOptional()
  @IsIn(['true', 'false'])
  undo?: string;
}

/** POST /importer/users/delete — حذف کامل انتخاب‌شده‌ها (خطرناک) */
export class DeleteUsersDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsMongoId({ each: true })
  ids!: string[];
}

/** POST /importer/migrate-b — مهاجرت رکوردهای قدیمی به ساختار b */
export class MigrateBDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;
}

// ─── مدیریت آگهی‌های ایمپورت‌شده (بخش «دیتا ایمپورت → آگهی‌ها») ────────────────

/** GET /importer/products — فیلتر/سورت/صفحه‌بندی جدول آگهی‌ها */
export class ImportedListingsQueryDto {
  /** جستجو: نام آگهی، شناسهٔ عددی، نام/شماره/یوزرنیم فروشنده */
  @IsOptional()
  @IsString()
  @Length(1, 60)
  q?: string;

  /** منبع: پاسکالی (فروشنده سند b دارد) / ثبت‌نام خودی فروشنده */
  @IsOptional()
  @IsIn(['buskool', 'native', 'all'])
  source?: 'buskool' | 'native' | 'all';

  /** رفتار ورود فروشنده: ever / never */
  @IsOptional()
  @IsIn(['ever', 'never'])
  ownerLogin?: 'ever' | 'never';

  /** ویرایش‌شده توسط خود فروشنده (ProductEditHistory با action=edit) */
  @IsOptional()
  @IsIn(['yes', 'no'])
  edited?: 'yes' | 'no';

  @IsOptional()
  @IsIn(['pending', 'confirmed', 'rejected', 'deleted', 'all'])
  status?: 'pending' | 'confirmed' | 'rejected' | 'deleted' | 'all';

  @IsOptional()
  @IsIn(['yes', 'no'])
  hasPhotos?: 'yes' | 'no';

  /** بازهٔ تاریخ ثبت آگهی (created_at) — ISO میلادی */
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  /** بازهٔ تاریخ آخرین تغییر آگهی (updated_at) — ISO میلادی */
  @IsOptional()
  @IsISO8601()
  updatedFrom?: string;

  @IsOptional()
  @IsISO8601()
  updatedTo?: string;

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'priceUpdatedAt', 'views', 'name'])
  sort?: 'createdAt' | 'updatedAt' | 'priceUpdatedAt' | 'views' | 'name';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(100)
  pageSize?: number;
}

/** GET /importer/product-images — آلبوم تصاویر آگهی‌ها (تعقیب واترمارک پاسکال) */
export class ProductImagesQueryDto {
  /** جستجو: نام آگهی، شناسهٔ عددی آگهی، نام/شماره/یوزرنیم فروشنده */
  @IsOptional()
  @IsString()
  @Length(1, 60)
  q?: string;

  /** منبع تصویر: metadata.importedFrom=pascal / بقیه */
  @IsOptional()
  @IsIn(['buskool', 'native', 'all'])
  source?: 'buskool' | 'native' | 'all';

  /** تعویض‌شده توسط ادمین (metadata.replacedAt) */
  @IsOptional()
  @IsIn(['yes', 'no'])
  replaced?: 'yes' | 'no';

  /**
   * حالت نمایش (خواستهٔ مالک ۱۶-۱۱ عصر): group=product → هر آگهی یک ردیف با
   * «همهٔ» عکس‌هایش (۳۰۰×۳۰۰) — واترمارک هیچ عکسی از قلم نمی‌افتد؛
   * پیش‌فرض تخت (یک ردیف به‌ازای هر فایل) برای سازگاری.
   */
  @IsOptional()
  @IsIn(['product'])
  group?: 'product';

  /**
   * فیلد سورت (خواستهٔ مالک ۱۵-۱۱: آخرین آپدیت‌ها اول لیست، بعد ثبت).
   * ⚠️ تاریخ‌های فایل همگی زمان ایمپورت‌اند؛ سورت‌های معنادار روی تاریخِ
   * خودِ آگهی‌اند (productUpdated پیش‌فرض). legacy: newest/oldest → ایمپورت.
   */
  @IsOptional()
  @IsIn([
    'productUpdated',
    'productCreated',
    'productId',
    'size',
    'photoCount',
    'createdAt',
    'updatedAt',
    'newest',
    'oldest',
  ])
  sort?:
    | 'productUpdated'
    | 'productCreated'
    | 'productId'
    | 'size'
    | 'photoCount'
    | 'createdAt'
    | 'updatedAt'
    | 'newest'
    | 'oldest';

  /** جهت سورت — پیش‌فرض نزولی (جدید→قدیم) */
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  /** بازهٔ تاریخ ثبتِ خودِ آگهی (Product.created_at) — ISO میلادی */
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  /** بازهٔ تاریخ آخرین تغییرِ خودِ آگهی (Product.updated_at) — ISO میلادی */
  @IsOptional()
  @IsISO8601()
  updatedFrom?: string;

  @IsOptional()
  @IsISO8601()
  updatedTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  /** پیش‌فرض ۵۰ (خواستهٔ مالک ۱۵-۱۱: ۵۰ رکورد در هر صفحه) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(100)
  pageSize?: number;
}

// ─── «فقط تصاویر» — شکار واترمارک (خواستهٔ مالک ۱۹-۱۱) ─────────────────────

/** GET /importer/product-files — کاش‌های تنها: خود تصویر + شناسهٔ فایل + سوییچ
 *  واترمارک؛ نه عنوان آگهی نه هیچ دادهٔ دیگر */
export class ProductFilesQueryDto {
  /** فیلتر واترمارک — مبنای جداکردن لیست علامت‌خورده‌ها برای پاک‌سازی؛
   *  fixed = اصلاح‌شده‌ها (تب «اصلاح واترمارک» — خواستهٔ مالک ۱۹-۱۱):
   *  تصاویری که واترمارکشان حذف شده و دیگر در تب «همه» نمی‌آیند */
  @IsOptional()
  @IsIn(['yes', 'no', 'fixed'])
  watermark?: 'yes' | 'no' | 'fixed';

  /** فقط تصاویر این آگهی (شناسهٔ عددی) — لینک عمیق «N عکس» از صفحهٔ آگهی‌ها */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId?: number;

  /** سورت (خواستهٔ مالک ۱۹-۱۱ عصر): تاریخ‌های معنادارِ خودِ آگهی (پاسکال) —
   *  تاریخ‌های خودِ فایل همگی «زمان ایمپورت»‌اند و برای شکار واترمارک
   *  بی‌معنا هستند. پیش‌فرض = زمان ثبت (مالک: «پیشفرض رو بزار بر حسب زمان
   *  ثبت»)؛ productUpdated = آخرین ویرایش آگهی — برای بررسی اینکه آیا
   *  آگهی‌های ویرایش‌شده هم واترمارک گرفته‌اند یا فقط تازه‌ثبت‌شده‌ها */
  @IsOptional()
  @IsIn(['productCreated', 'productUpdated'])
  sort?: 'productCreated' | 'productUpdated';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  /** پیش‌فرض ۶۰ — شبکهٔ کاشی؛ ۱۰ = پنجرهٔ اسکن دو ردیفهٔ ۵تایی (۱۹-۱۱ عصر) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  pageSize?: number;
}

/** POST /importer/product-files/:id/watermark — دو تیک «دارد/ندارد»
 *  (خواستهٔ مالک ۱۹-۱۱ شب): true = واترمارک دارد | false = بررسی‌شده بدون
 *  واترمارک | null = پس‌گرفتن بررسی (بازگشت به لیست باقی‌مانده) */
export class SetFileWatermarkDto {
  @IsIn([true, false, null])
  hasWatermark!: boolean | null;
}

/** POST /importer/product-files/wm-batch — تعداد فایل‌های هر دستهٔ «اصلاح
 *  خودکار» (UI حلقه می‌زند؛ سقف ۱۰ تا در سقف زمانی ۶۰ ثانیه‌ای ورسل جا شود) */
export class WmBatchDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;

  /** فایل‌هایی که در دورهای قبل «پیدا نشد/خطا» شدند — از صف این دسته کنار
   *  گذاشته می‌شوند تا حلقهٔ UI روی همان‌ها گیر نکند (دستکاری DB نمی‌شوند) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  exclude?: string[];
}

/** POST /importer/product-files/review-batch — دکمهٔ «بررسی شد» پایین صفحه
 *  (خواستهٔ مالک ۲۱-۱۱): مهر گروهی watermarkReviewedAt روی همهٔ تصاویرِ دستهٔ
 *  فعلی — یعنی «این N تصویر بررسی شد؛ هر کدام لازم بود اصلاح شد» و دیگر
 *  هرگز در صفحهٔ بررسی لود نمی‌شوند؛ دستهٔ بعدی جای آن‌ها را می‌گیرد. */
export class ReviewFilesDto {
  /** شناسهٔ فایل‌های دستهٔ فعلی (حداکثر ۲۰۰ = سقف صفحه‌بندی + حاشیه) */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}

// ═══════════════════ آپدیت قیمت‌ها + کاربران جدید (۲۱-۱۱) ═══════════════════

/** POST /importer/update/scan — یک تکهٔ ۱۰۰۰تایی از جدیدترین آگهی‌های پاسکال:
 *  آپدیت قیمت/موجودی/حداقل‌سفارش آگهی‌های موجود + لیست کاربران تازه‌ثبت‌نامِ
 *  غایب در ایمچ. فرانت حلقهٔ بچ‌ها را می‌چرخاند (۵ث فاصله). */
export class UpdateScanDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;

  /** رکورد شروع — بازهٔ [from, to) نیمه‌باز و ۰-بنیاد است (تست زندهٔ ۲۱-۱۱:
   *  from=0,to=5 پنج آیتم می‌دهد؛ from=1 چهار آیتم). بچ اول: 0→1000 */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from!: number;

  /** رکورد پایان — حداکثر from+1000 (سقف سرویس) */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  to!: number;

  /** پیش‌فرض true — false یعنی فقط شناسایی کاربران بدون دست‌زدن به قیمت‌ها */
  @IsOptional()
  @IsBoolean()
  updatePrices?: boolean;

  /** فقط کاربرانِ ثبت‌نام‌شده در این چند روز اخیر — ۰ = همهٔ غایب‌ها */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  recentDays?: number;
}

/** POST /importer/update/fetch-phone — شمارهٔ موبایل فروشندهٔ پاسکال
 *  (get-user-phone-number-for-the-seller با کوکی؛ هر کوکی ۲۰ شماره — ۲۲-۱۱
 *  اندپوینت همان چیزی شد که خود پاسکال در مرورگر می‌زند).
 *  bUserName اختیاری: داده شود شماره روی رکورد «در انتظار ایمپورت» ذخیره
 *  می‌شود (دکمهٔ «گرفتن موبایل» — خواستهٔ مالک ۲۲-۱۱). */
export class FetchPhoneDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;

  /** شناسهٔ کاربر پاسکال (user_info.id) */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sId!: number;

  /** شناسهٔ آگهی پاسکال — p_id اندپوینت قدیمی گوشی‌گیری (اختیاری؛ ۲۳-۱۱:
   *  با s_id/نمونه‌آگهی مکانیزم برنامهٔ قدیمی هم امتحان می‌شود) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pId?: number;

  /** شناسهٔ پروفایل فروشندهٔ پاسکال (myuser_id) — s_id اندپوینت قدیمی
   *  گوشی‌گیری؛ اختیاری: نبودش خودکار از پروفایل عمومی خوانده می‌شود */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sProfileId?: number;

  /** یوزرنیم پاسکال برای ذخیرهٔ شماره روی رکورد «در انتظار ایمپورت» */
  @IsOptional()
  @IsString()
  @Length(2, 64)
  bUserName?: string;
}

/** POST /importer/update/pending — لیست «کاربران در انتظار ایمپورت»
 *  (خواستهٔ مالک ۲۲-۱۱): رکوردهای ماندگار دیتابیس؛ رکورد کاربرِ
 *  ایمپورت‌شدهٔ کامل موقع خواندن خودکار حذف می‌شود.
 *  نوسازی ۲۳-۱۱ (خواستهٔ مالک): صفحه‌بندی ۵۰تایی + فیلتر روزِ ثبت‌نام —
 *  days=0 امروز، ۱ دیروز، … ; غایب/null یعنی همهٔ روزها. */
export class PendingListDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;

  /** شمارهٔ صفحه — ۱-بنیاد؛ پیش‌فرض ۱ */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  /** تعداد ردیف هر صفحه — پیش‌فرض ۵۰ (خواستهٔ مالک ۲۳-۱۱) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(100)
  pageSize?: number;

  /** فقط ثبت‌نام‌های «همین روز تقویمی تهرانِ N روز پیش» — نزول=همهٔ روزها */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  days?: number;
}

/** POST /importer/update/extract-user — پیش‌ایمپورت یک یوزرنیم پاسکال:
 *  چک وجود در ایمچ (bUserName) + گرفتن شماره؛ ایمپورت کامل با startSingle */
export class ExtractUserDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;

  @IsString()
  @Length(2, 64)
  userName!: string;
}

/** POST /importer/update/pascal-cookie — ستِ کوکی پاسکال از مودال پنل
 *  (خواستهٔ مالک ۲۳-۱۱ عصر: «اگر خطا داد یه مدال باز کن و از من بخوای کوکی
 *  رو اونجا پیست کنم و خودت پشت صحنه ست کنی» — بدون .env دستی/ری‌استارت).
 *  متن چسبانده‌شده هر شکلی باشد (هدر کامل/خط‌به‌خط/با Cookie:/رمزگشایی‌شده)
 *  پاک‌سازی می‌شود؛ بعد از ذخیره سنجش زندهٔ لاگین (/api/user) برگردانده
 *  می‌شود تا فرانت نتیجه را همان‌جا نشان دهد و در صورت موفقیت، عملِ شکست‌خورده
 *  را خودکار تکرار کند. */
export class SetPascalCookieDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;

  /** کل هدر cookie مرورگرِ لاگین‌شده (یا خط‌به‌خط آن) */
  @IsString()
  @Length(20, 8_000)
  cookie!: string;
}

/** POST /importer/update/set-phone — ثبت دستی شمارهٔ موبایل روی رکورد
 *  «در انتظار ایمپورت» (خواستهٔ مالک ۲۴-۱۱: «اگر در رکورد کاربر شماره
 *  نبود و با کد هم نتونستی بگیری، مودال باز کن و بگو شماره موبایل رو
 *  وارد کن؛ بعد من دستی از باسکول می‌گیرم و وارد می‌کنم؛ بعد تو اول
 *  شماره رو اینزت کن توی دیتابیس و بعد بلافاصله شروع کن به ایمپورت»).
 *  شماره اول روی رکورد انتظار ذخیره می‌شود (همان‌جایی که «گرفتن موبایل»
 *  می‌نویسد) تا ایمپورت مستقیم و بدون مصرف سهمیهٔ کوکی شروع شود. */
export class SetPendingPhoneDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;

  /** یوزرنیم پاسکال — رکورد «در انتظار ایمپورت» با همین کلید پیدا می‌شود */
  @IsString()
  @Length(2, 64)
  bUserName!: string;

  /** شمارهٔ موبایل دستی — ۰۹… ۱۱رقمی؛ ارقام فارسی/عربی و +98 هم پذیرفته
   *  می‌شود و به ۰۹XXXXXXXXX نرمال می‌شود */
  @IsString()
  @Length(10, 20)
  phone!: string;
}
