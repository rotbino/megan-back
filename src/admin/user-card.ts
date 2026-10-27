/**
 * کمکی مشترک صفحات ادمین — کارت کاربر برای نمایش طرف‌های مکالمه/تماس.
 *
 * نام نمایشی: نام کامل → username → موبایل. کاربران seed (ایمپورت‌شده
 * برای SEO) اغلب بی‌نام‌اند → username/موبایل به‌عنوان نام نشان داده می‌شود.
 */

export interface UserCard {
  id: string;
  firstName: string;
  lastName: string;
  userName: string;
  phone: string;
  displayName: string;
  isActive: boolean;
  isVerified: boolean;
  lastLoginAt: Date | null;
}

/** select سبک و ثابت — همه جاهایی که طرف مکالمه/تماس نمایش داده می‌شود */
export const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  userName: true,
  phone: true,
  isActive: true,
  isVerified: true,
  lastLoginAt: true,
} as const;

/** نام نمایشی: نام کامل → username → موبایل */
export function displayName(u: {
  firstName: string;
  lastName: string;
  userName: string;
  phone: string;
}): string {
  const full = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  return full || u.userName || u.phone;
}

export function toUserCard(u: {
  id: string;
  firstName: string;
  lastName: string;
  userName: string;
  phone: string;
  isActive: boolean;
  isVerified: boolean;
  lastLoginAt: Date | null;
}): UserCard {
  return { ...u, displayName: displayName(u) };
}
