import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/**
 * DTOهای «پیگیری‌ها» — CRM کوچک ایمچ (خواسته مالک ۶-۱۱).
 *
 * فروشنده درخواست‌های خرید و خریدار آگهی‌های فروش را در «پرونده»های نام‌دار
 * ذخیره می‌کند و با قیف وضعیت + یادداشت‌های زمان‌دار پیگیری می‌کند.
 * جریان ذخیره دومرحله‌ای است: ۱) انتخاب/ساخت پرونده ۲) وضعیت + یادداشت اختیاری.
 */

/** قیف پیگیری — مقدار سیمی مثل فرانت */
export const FOLLOW_STATUSES = [
  'reviewing', // در بررسی
  'contacted', // تماس گرفتم
  'negotiating', // در مذاکره
  'closed', // نهایی شد
  'dropped', // منصرف شدم
] as const;
export type FollowStatus = (typeof FOLLOW_STATUSES)[number];

/** برچسب فارسی وضعیت‌ها — برای پیام‌های خطا و مستندات */
export const FOLLOW_STATUS_LABELS: Record<FollowStatus, string> = {
  reviewing: 'در بررسی',
  contacted: 'تماس گرفتم',
  negotiating: 'در مذاکره',
  closed: 'نهایی شد',
  dropped: 'منصرف شدم',
};

/** اولویت پیگیری (خواسته مالک ۷-۱۱) — 1: بالا، 2: متوسط، 3: کم.
 *  Int نگه داشتیم مثل وضعیت سیمی؛ سمت فرانت متادیتای نمایشی دارد. */
export const FOLLOW_PRIORITIES = [1, 2, 3] as const;
export type FollowPriority = (typeof FOLLOW_PRIORITIES)[number];

/** انواع هدف پیگیری — دید فروشنده (درخواست خرید) یا دید خریدار (آگهی فروش) */
export const FOLLOW_TARGET_TYPES = ['buy_request', 'product'] as const;
export type FollowTargetType = (typeof FOLLOW_TARGET_TYPES)[number];

/** نوع پرونده/سرنخ — مستقل‌سازی کامل دو نوع (خواستهٔ مالک ۸-۱۱ دور ۲۸):
 *  buy: سرنخ خرید — آگهی فروشِ ذخیره‌شده (دید خریدار)
 *  sell: سرنخ فروش — درخواست خریدِ ذخیره‌شده (دید فروشنده) */
export const FOLLOW_FOLDER_KINDS = ['buy', 'sell'] as const;
export type FollowFolderKind = (typeof FOLLOW_FOLDER_KINDS)[number];

const OID_RE = /^[0-9a-fA-F]{24}$/;
export function isOid(v: unknown): v is string {
  return typeof v === 'string' && OID_RE.test(v);
}

/** POST /follow/getFolders — پرونده‌های کاربر با تعداد و خلاصه قیف؛
 *  kind اختیاری: فقط پرونده‌های همان نوع سرنخ (خرید/فروش) */
export class GetFoldersDto {
  @IsOptional()
  @IsIn(FOLLOW_FOLDER_KINDS as unknown as string[])
  kind?: FollowFolderKind;
}

/** POST /follow/createFolder — «پرونده جدید» با نام یکتا در همان نوع سرنخ */
export class CreateFolderDto {
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsOptional()
  @IsIn(FOLLOW_FOLDER_KINDS as unknown as string[])
  kind?: FollowFolderKind;
}

/** POST /follow/renameFolder — تغییر نام پرونده */
export class RenameFolderDto {
  @IsString()
  folderId!: string;

  @IsString()
  @Length(1, 60)
  name!: string;
}

/** POST /follow/deleteFolder — حذف پرونده با همه موارد و یادداشت‌ها */
export class DeleteFolderDto {
  @IsString()
  folderId!: string;
}

/** POST /follow/getFolderItems — کارت‌های یک پرونده با snapshot هدف */
export class GetFolderItemsDto {
  @IsString()
  folderId!: string;
}

/** POST /follow/upsertItem — ذخیره/به‌روزرسانی (مرحله ۲ جریان ذخیره).
 *  اگر هدف از قبل ذخیره باشد: به پروندهٔ انتخابی منتقل و وضعیتش به‌روز می‌شود؛
 *  یادداشت فقط در صورت ارسال متن جدید اضافه می‌شود. */
export class UpsertItemDto {
  @IsString()
  folderId!: string;

  @IsIn(FOLLOW_TARGET_TYPES as unknown as string[])
  targetType!: FollowTargetType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  targetId!: number;

  @IsOptional()
  @IsIn(FOLLOW_STATUSES as unknown as string[])
  status?: FollowStatus;

  /** اولویت — 1 بالا / 2 متوسط / 3 کم (اختیاری، پیش‌فرض متوسط) */
  @IsOptional()
  @IsIn(FOLLOW_PRIORITIES as unknown as number[])
  priority?: FollowPriority;

  /** «پیگیری بعدی N روز دیگر» — 0 یا ارسال نشدن = بدون یادآور (اختیاری) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  nextFollowDays?: number;

  /** یادداشت اولیه — اختیاری (خواسته مالک: یادداشت اجباری نیست) */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

/** POST /follow/setItemStatus — تغییر وضعیت قیف */
export class SetItemStatusDto {
  @IsString()
  itemId!: string;

  @IsIn(FOLLOW_STATUSES as unknown as string[])
  status!: FollowStatus;
}

/** POST /follow/setItemPriority — تغییر اولویت (زیر سه‌نقطه و مودال؛
 *  خواسته مالک ۷-۱۱) — اولویت بالا = 1 در لیست بالاتر */
export class SetItemPriorityDto {
  @IsString()
  itemId!: string;

  @IsIn(FOLLOW_PRIORITIES as unknown as number[])
  priority!: FollowPriority;
}

/** POST /follow/setNextFollow — «پیگیری بعدی N روز دیگر»؛ days=0 یعنی حذف یادآور */
export class SetNextFollowDto {
  @IsString()
  itemId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  days!: number;
}

/** POST /follow/moveItem — انتقال به پرونده دیگر (وضعیت و یادداشت‌ها حفظ می‌شوند) */
export class MoveItemDto {
  @IsString()
  itemId!: string;

  @IsString()
  folderId!: string;
}

/** POST /follow/addItemNote — یادداشت زمان‌دار جدید */
export class AddItemNoteDto {
  @IsString()
  itemId!: string;

  @IsString()
  @Length(1, 500)
  text!: string;
}

/** POST /follow/removeItem — حذف مورد از پیگیری */
export class RemoveItemDto {
  @IsString()
  itemId!: string;
}

/** POST /follow/isFollowing — آیا این هدف در پیگیری منست؟ (وضعیت دکمه‌های ذخیره) */
export class IsFollowingDto {
  @IsIn(FOLLOW_TARGET_TYPES as unknown as string[])
  targetType!: FollowTargetType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetId!: number;
}

/** POST /follow/getFollowingMap — همهٔ موارد ذخیره‌شدهٔ یک نوع؛
 *  یک درخواست مشترک برای همهٔ دکمه‌های ذخیرهٔ یک صفحه به‌جای N درخواست isFollowing */
export class GetFollowingMapDto {
  @IsIn(FOLLOW_TARGET_TYPES as unknown as string[])
  targetType!: FollowTargetType;
}

/** POST /follow/getAllItems — همهٔ موارد کاربر از همهٔ پرونده‌ها (تک‌صفحهٔ CRM)؛
 *  targetType اختیاری: فقط همان نوع (product=سرنخ خرید / buy_request=سرنخ فروش) */
export class GetAllItemsDto {
  @IsOptional()
  @IsIn(FOLLOW_TARGET_TYPES as unknown as string[])
  targetType?: FollowTargetType;
}
