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

/** انواع هدف پیگیری — دید فروشنده (درخواست خرید) یا دید خریدار (آگهی فروش) */
export const FOLLOW_TARGET_TYPES = ['buy_request', 'product'] as const;
export type FollowTargetType = (typeof FOLLOW_TARGET_TYPES)[number];

const OID_RE = /^[0-9a-fA-F]{24}$/;
export function isOid(v: unknown): v is string {
  return typeof v === 'string' && OID_RE.test(v);
}

/** POST /follow/getFolders — پرونده‌های کاربر با تعداد و خلاصه قیف */
export class GetFoldersDto {}

/** POST /follow/createFolder — «پرونده جدید» با نام یکتا */
export class CreateFolderDto {
  @IsString()
  @Length(1, 60)
  name!: string;
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
