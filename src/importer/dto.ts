import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
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
  @IsInt()
  @Min(1)
  @Max(500)
  maxProducts?: number;
}

export class ListImportDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
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
