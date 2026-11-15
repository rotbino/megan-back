import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
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

// ─── مدیریت کاربران ایمپورت‌شده (بخش «دیتا ایمپورت») ────────────────────────────

/** GET /importer/users — فیلتر/سورت/صفحه‌بندی جدول مدیریت */
export class ImportedUsersQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  q?: string;

  @IsOptional()
  @IsIn(['buskool', 'native', 'stub', 'all'])
  source?: 'buskool' | 'native' | 'stub' | 'all';

  /** ویژهٔ باسکول (b.premium.isPremium) — نه اعتبار آیمچ */
  @IsOptional()
  @IsIn(['yes', 'no'])
  premium?: 'yes' | 'no';

  /** نوع بستهٔ باسکول: 0=رایگان ۱=دوماهه ۲=شش‌ماهه ۳=یک‌ساله */
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
  @IsIn(['lastLogin', 'createdAt', 'products', 'buskoolCreated', 'imported', 'contacted'])
  sort?: 'lastLogin' | 'createdAt' | 'products' | 'buskoolCreated' | 'imported' | 'contacted';

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

  /** منبع: باسکولی (فروشنده سند b دارد) / ثبت‌نام خودی فروشنده */
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

/** GET /importer/product-images — آلبوم تصاویر آگهی‌ها (تعقیب واترمارک باسکول) */
export class ProductImagesQueryDto {
  /** جستجو: نام آگهی، شناسهٔ عددی آگهی، نام/شماره/یوزرنیم فروشنده */
  @IsOptional()
  @IsString()
  @Length(1, 60)
  q?: string;

  /** منبع تصویر: metadata.importedFrom=buskool / بقیه */
  @IsOptional()
  @IsIn(['buskool', 'native', 'all'])
  source?: 'buskool' | 'native' | 'all';

  /** تعویض‌شده توسط ادمین (metadata.replacedAt) */
  @IsOptional()
  @IsIn(['yes', 'no'])
  replaced?: 'yes' | 'no';

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
