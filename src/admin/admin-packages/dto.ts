import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** DTO های مدیریت بسته‌های اشتراک و کمپین‌ها (admin/packages/*) */

/** POST /admin/packages/getPackageOrders — صف بررسی فیش‌های بسته */
export class GetAdminPackageOrdersDto {
  /** فقط سفارش‌های با این وضعیت */
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: 'pending' | 'approved' | 'rejected';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  perPage?: number;
}

/** POST /admin/packages/reviewPackageOrder — تأیید (بسته فعال/تمدید) یا رد با دلیل */
export class ReviewAdminPackageOrderDto {
  @IsString()
  @IsNotEmpty({ message: 'شناسه سفارش الزامی است.' })
  orderId!: string;

  /** true = تأیید، false = رد */
  @IsBoolean()
  approve!: boolean;

  /** دلیل رد — در رد اجباری است */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

/** POST /admin/packages/upsertPlan — ساخت/ویرایش بسته (id خالی = ساخت) */
export class UpsertPlanDto {
  @IsOptional()
  @IsString()
  id?: string;

  /** کلید یکتا — p2m | p6m | … */
  @IsString()
  @IsNotEmpty({ message: 'کلید بسته الزامی است.' })
  @MaxLength(20)
  key!: string;

  @IsString()
  @IsNotEmpty({ message: 'عنوان بسته الزامی است.' })
  @MaxLength(40)
  title!: string;

  /** مدت (ماه) */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  months!: number;

  /** قیمت پایه (تومان) */
  @Type(() => Number)
  @IsInt()
  @Min(10_000)
  @Max(1_000_000_000)
  amount!: number;

  /** سطح — ۱=دوماهه ۲=شش‌ماهه ۳=یک‌ساله (روی activePakageType کاربر) */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  pakageType!: number;

  @IsBoolean()
  bestSeller!: boolean;

  /** ویژگی‌های بسته — ردیف‌های کارت قیمت */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  features!: string[];

  /** نمایش در صفحه بسته‌ها */
  @IsBoolean()
  isActive!: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

/** POST /admin/packages/deletePlan — حذف (با سفارش → غیرفعال) */
export class DeletePlanDto {
  @IsString()
  @IsNotEmpty()
  id!: string;
}

/** پله کمپین تعدادی */
export class CampaignTierDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  from!: number;

  /** null = تا پایان کمپین */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  to?: number | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  percent!: number;
}

/** POST /admin/packages/getCampaigns — لیست کمپین‌ها */
export class GetCampaignsDto {
  /** active | inactive */
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: string;
}

/** POST /admin/packages/upsertCampaign — ساخت/ویرایش کمپین (id خالی = ساخت) */
export class UpsertCampaignDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @IsNotEmpty({ message: 'عنوان کمپین الزامی است.' })
  @MaxLength(80)
  title!: string;

  /** شعار/توضیح — بالای بسته‌ها نمایش داده می‌شود */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;

  /** time | quantity */
  @IsIn(['time', 'quantity'])
  type!: 'time' | 'quantity';

  /** درصد تخفیف پایه (در زمانی = جاری) */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  discountPercent!: number;

  /** override دستی درصد جاری — null = خودکار پله‌ای */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  manualDiscountPercent?: number | null;

  /** ISO — خالی = اکنون */
  @IsOptional()
  @IsString()
  startsAt?: string;

  /** ISO — خالی = بی‌پایان */
  @IsOptional()
  @IsString()
  endsAt?: string | null;

  @IsBoolean()
  isActive!: boolean;

  /** پله‌های کمپین تعدادی */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CampaignTierDto)
  tiers?: CampaignTierDto[];
}

/** POST /admin/packages/deleteCampaign */
export class DeleteCampaignDto {
  @IsString()
  @IsNotEmpty()
  id!: string;
}

/** POST /admin/packages/setCampaignDiscount — تغییر سریع درصد جاری */
export class SetCampaignDiscountDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  /** null = برگشت به محاسبه خودکار پله‌ای */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  manualDiscountPercent?: number | null;
}
