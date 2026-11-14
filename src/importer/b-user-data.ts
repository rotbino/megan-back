/**
 * ساختار فیلد `b` روی مدل User — «سند رفتار کاربر در باسکول» (خواستهٔ مالک ۱۳-۱۱).
 *
 * همهٔ داده‌های مختص باسکول که برای بازاریابی/تحلیل لازم است در همین یک
 * فیلد JSON نگه داشته می‌شود (به‌جای پخش‌کردن فیلدهای b_* در جای‌جای مدل).
 * دو مصرف‌کننده دارد:
 *   • ImporterService — هنگام ایمپورت می‌سازدش
 *   • ImportedUsersService — صفحهٔ «مدیریت کاربران ایمپورت‌شده» فیلتر/سورت/CRM
 *
 * ⚠️ قاعدهٔ طلایی (خواستهٔ مالک): ویژه بودنِ باسکول هرگز به activePakageType
 * آیمچ کپی نمی‌شود — کاربر فقط با پرداخت واقعی در آیمچ ویژه می‌شود. b.premium
 * فقط برای شناسایی «ویژه‌های سابق باسکول» است تا بعداً با تماس و پیشنهاد
 * تخفیف، خودشان پکیج بخرند.
 */

/** عنوان فارسی بستهٔ باسکول از کد (۰=رایگان ۱=دوماهه ۲=شش‌ماهه ۳=یک‌ساله) */
export function bkPackageTitle(type: number): string {
  const titles: Record<number, string> = { 0: 'رایگان', 1: 'دوماهه', 2: 'شش‌ماهه', 3: 'یک‌ساله' };
  return titles[type] ?? `نوع ${type}`;
}

export interface BUserData {
  /** منبع داده — پس از ایمپورترهای آیندهٔ سایت‌های دیگر هم همین فیلد کلید تشخیص است */
  source: 'buskool';
  /** یوزرنیم باسکول (همان bUserName) */
  userName: string;
  /** id عددی باسکول (myuser_id) */
  userId: number;
  /** id سند myuser_profiles باسکول */
  profileId: number | null;

  // ── ویژه بودن در باسکول — فقط دادهٔ رفتاری، نه اعتبار در آیمچ ──
  premium: {
    isPremium: boolean;
    /** active_pakage_type خام باسکول */
    packageType: number;
    /** عنوان فارسی بسته */
    packageTitle: string;
  };

  // ── وضعیت و رفتار کاربر در باسکول ──
  isVerified: boolean;
  isBuyer: boolean;
  isSeller: boolean;
  isBlocked: boolean;
  /** موجودی کیف پول باسکول (تومان) */
  walletBalance: number;
  /** مجوز نمایش شماره در باسکول (مثل «1111») */
  phoneViewPermission: string | null;
  categoryId: number | null;
  /** بیت‌مپ وضعیت مشتری باسکول */
  customerStatus: string | null;
  /** بیت‌مپ وضعیت پشتیبانی باسکول */
  supportStatus: string | null;
  /** کاربر از کجا به باسکول آمده (utm-like باسکول) */
  comingFrom: string | null;
  /** نوع فعالیت باسکول (رشتهٔ عددی: تولیدی/بازرگانی/…) */
  activityType: string | null;
  /** دامنهٔ فعالیت به نام — مثل «تنقلات و شیرینی» */
  activityDomain: string | null;
  sex: string | null;
  province: string | null;
  city: string | null;

  // ── کسب‌وکار (myuser_profiles باسکول) ──
  address: string | null;
  postalCode: string | null;
  isCompany: boolean;
  companyName: string;
  companyRegisterCode: string | null;
  confirmed: boolean;
  /** URL عکس‌های مرتبط باسکول (related-photos آروان) — از ۱۴-۱۱ هنگام
   *  ایمپورت در گالری کسب‌وکار کاربر هم rehost می‌شوند (اسلات استاندارد
   *  gallery روی User)؛ این آرایه منبع بازآوری کاربران قدیمی است */
  relateds: string[];
  /** URL اصلی عکس پروفایل در باسکول (پیش از rehost در آیمچ) */
  profilePhotoUrl: string | null;
  /** متن خام description باسکول — فقط برای متن «خودِ کاربر»؛ متن خودکار آرشیو نمی‌شود */
  descriptionRaw: string | null;
  /** آیا متن خودکار باسکول/اینکوباک بود (دو قالب «… در بازار بزرگ …» / «… در سامانه ی … هستم»)؟ → در businessDesc ننشست */
  descriptionIsAuto: boolean;

  // ── آمار باسکول (get_user_statistics) ──
  responseRate: number | null;
  reputationScore: string | null;
  productsCount: number | null;
  ratingCount: number | null;
  ratingAvg: number | null;
  /** نشان ibp باسکول */
  ibp: boolean;

  // ── زمان‌ها ──
  /** ثبت‌نام در باسکول (ISO) */
  createdAt: string | null;
  /** اولین ایمپورت موفق به آیمچ (ISO) — در ایمپورت مجدد حفظ می‌شود */
  importedAt: string;

  // ── CRM — مدیریت از صفحهٔ «کاربران ایمپورت‌شده» ──
  /** آخرین باری که مالک با این کاربر تماس گرفت/دعوتش کرد (ISO) */
  contactedAt: string | null;
}

/** خواندن امن فیلد b یک سند User (Prisma Json → BUserData) */
export function asBUserData(raw: unknown): BUserData | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Partial<BUserData>;
  if (b.source !== 'buskool') return null;
  return raw as BUserData;
}
