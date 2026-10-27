import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

/** وضعیت‌های مجاز CRM — عین چیپ‌های پنل باسکول */
export const SAVED_USER_STATUSES = [
  'following',
  'not_needed',
  'unresponsive',
  'out_of_stock',
  'priority_high',
  'priority_medium',
  'priority_low',
] as const;

export type SavedUserStatus = (typeof SAVED_USER_STATUSES)[number];

const OID_RE = /^[0-9a-fA-F]{24}$/;
export function isOid(v: unknown): v is string {
  return typeof v === 'string' && OID_RE.test(v);
}

/** POST /saved/createSavedList — «لیست جدید» */
export class CreateSavedListDto {
  @IsString()
  @Length(1, 60)
  name!: string;
}

/** POST /saved/updateSavedList — تنظیمات لیست: تغییر نام */
export class UpdateSavedListDto {
  @IsString()
  listId!: string;

  @IsString()
  @Length(1, 60)
  name!: string;
}

/** POST /saved/deleteSavedList — تنظیمات لیست: حذف */
export class DeleteSavedListDto {
  @IsString()
  listId!: string;
}

/** POST /saved/getSavedListUsers — کارت‌های CRM یک لیست */
export class GetSavedListUsersDto {
  @IsString()
  listId!: string;
}

/** POST /saved/saveBuyerToList — «نشان کردن» خریدار از کارت لیست عمومی/پنل */
export class SaveBuyerToListDto {
  /** ObjectId خریدار (myuserId از DTO درخواست خرید) */
  @IsString()
  targetUserId!: string;

  /** لیست مقصد — یا id موجود یا نام لیست جدید */
  @IsOptional()
  @IsString()
  listId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  listName?: string;
}

/** POST /saved/setSavedUserStatus */
export class SetSavedUserStatusDto {
  @IsString()
  savedUserId!: string;

  @IsIn(SAVED_USER_STATUSES)
  status!: SavedUserStatus;
}

/** POST /saved/addSavedUserNote */
export class AddSavedUserNoteDto {
  @IsString()
  savedUserId!: string;

  @IsString()
  @Length(1, 500)
  text!: string;
}

/** POST /saved/moveSavedUser — «افزودن به لیست دیگر» */
export class MoveSavedUserDto {
  @IsString()
  savedUserId!: string;

  @IsString()
  toListId!: string;
}

/** POST /saved/removeSavedUser */
export class RemoveSavedUserDto {
  @IsString()
  savedUserId!: string;
}
