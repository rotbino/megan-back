/**
 * تسک‌های کاربر — «کارهای مهم من» (خواستهٔ مالک ۱۱-۱۱ دور ۴).
 *
 * هر تسک چیزی است که کاربر «باید انجام بدهد» و هنوز نکرده؛ تا انجام نشود
 * در پاسخ می‌ماند و بج زنگولهٔ فرانت (TasksBell) هم نمی‌پرد. جنس تسک‌ها:
 *  ۱. سرنخ‌های سررسیده (پیگیری امروز / عقب‌افتاده) — کاربر خودش یادآور گذاشته.
 *  ۲. احراز هویت — اعتماد طرف مقابل در تماس/چت.
 *  ۳. تکمیل پروفایل — عکس، نام، استان/شهر، دربارهٔ کسب‌وکار.
 *  ۴. اولین آگهی محصول (فروشنده) / اولین درخواست خرید (خریدار) — فعال‌سازی.
 *
 * تسک‌ها stateless اند: از وضعیت واقعی داده‌ها محاسبه می‌شوند، نه جدول
 * جدا؛ یعنی «انجام دادن» همان کار (مثلاً ارسال مدارک یا ثبت آگهی) تسک را
 * خودبه‌خود حذف می‌کند و هیچ دکمهٔ «انجام شد» لازم نیست.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import type { AuthUser } from '../common/guards';

export type TaskSeverity = 'urgent' | 'warning' | 'info';

export interface UserTaskDto {
  /** کلید پایدار — فرانت برای آیکون/رنگ مپ می‌کند */
  key: string;
  title: string;
  description: string;
  /** مقصد کلیک — دقیقاً همان فرم/صفحه‌ای که کار باید آنجا انجام شود */
  href: string;
  /** تعداد موارد (مثلاً N سرنخ سررسیده) — فقط برای تسک‌های شمارشی */
  count?: number;
  severity: TaskSeverity;
}

/** وضعیت‌هایی که پیگیری دیگر معنا ندارد — از شمارِ سررسیده‌ها کنار گذاشته می‌شوند */
const FOLLOW_DEAD_STATUSES = ['closed', 'dropped'];

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyTasks(user: AuthUser): Promise<UserTaskDto[]> {
    const [me, followGroups, verifyOrder, productCount, buyRequestCount] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: {
          isVerified: true,
          isBuyer: true,
          isSeller: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          provinceId: true,
          cityId: true,
          businessDesc: true,
        },
      }),
      // سرنخ‌های سررسیدهٔ امروز/عقب‌افتاده — به تفکیک نوع سرنخ (خرید/فروش).
      // نکتهٔ MongoDB (باگ ۱۱-۱۱): در ترتیب BSON، null قبل از Date می‌نشیند و
      // $lte روی فیلدِ null هم مَچ می‌شود — «not: null» یادآورهای حذف‌شده را
      // کنار می‌گذارد وگرنه سرنخِ بدون یادآور هم شمرده می‌شد.
      this.prisma.followItem.groupBy({
        by: ['targetType'],
        _count: { _all: true },
        where: {
          userId: user.id,
          nextFollowAt: { lte: endOfToday(), not: null },
          status: { notIn: FOLLOW_DEAD_STATUSES },
        },
      }),
      // آخرین سفارش احراز — برای تشخیص «رد شده → دوباره بفرست»
      this.prisma.verificationOrder.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        select: { status: true, rejectionReason: true },
      }),
      // آگهی‌های زنده — اولین قدم فعال‌سازی فروشنده
      this.prisma.product.count({
        where: { userId: user.id, status: { notIn: ['deleted'] } },
      }),
      // درخواست‌های زنده — اولین قدم فعال‌سازی خریدارِ خالص
      this.prisma.buyRequest.count({
        where: { userId: user.id, status: { notIn: ['deleted'] } },
      }),
    ]);

    const tasks: UserTaskDto[] = [];
    if (!me) return tasks;

    // ─── ۱. سرنخ‌های سررسیده — فوری‌ترین کار روز (خواستهٔ مالک: «مثل رسیدگی
    //     به پیگیری سرنخ» — یادآوری زنگوله تا پیگیری نکرده باشد) ────────────
    for (const g of followGroups) {
      const n = g._count._all;
      if (n <= 0) continue;
      if (g.targetType === 'product') {
        tasks.push({
          key: 'follow_due_buy',
          title: 'پیگیری سرنخ‌های خرید',
          description: `${toFa(n)} سرنخ ذخیره‌شده برای پیگیری امروز یا عقب‌افتاده دارید — تماس بگیرید یا یادآور جدید بگذارید.`,
          href: '/panel/saved?due=today',
          count: n,
          severity: 'urgent',
        });
      } else if (g.targetType === 'buy_request') {
        tasks.push({
          key: 'follow_due_sell',
          title: 'پیگیری سرنخ‌های فروش',
          description: `${toFa(n)} درخواست خرید ذخیره‌شده برای پیگیری امروز یا عقب‌افتاده دارید — مشتری‌های داغ منتظرند.`,
          href: '/panel/sell-leads?due=today',
          count: n,
          severity: 'urgent',
        });
      }
    }

    // ─── ۲. احراز هویت — «در حال بررسی» تسک نیست (کاری از کاربر برنمی‌آید) ──
    if (!me.isVerified && verifyOrder?.status !== 'pending') {
      tasks.push({
        key: 'verify',
        title: verifyOrder?.status === 'rejected' ? 'احراز هویت رد شده — دوباره بفرستید' : 'احراز هویت کنید',
        description:
          verifyOrder?.status === 'rejected' && verifyOrder.rejectionReason
            ? `دلیل رد: ${verifyOrder.rejectionReason} — مدارک را اصلاح و دوباره ارسال کنید.`
            : 'با آپلود مدارک، نشان «تایید هویت شده» می‌گیرید و طرف مقابل با خیال راحت به شما پیام و تماس می‌دهد.',
        href: '/panel/verification',
        severity: 'warning',
      });
    }

    // ─── ۳. تکمیل پروفایل — فقط بخش‌های واقعاً خالی فهرست می‌شوند ───────────
    const missing: string[] = [];
    if (!me.avatarUrl) missing.push('عکس پروفایل');
    if (!me.firstName.trim() && !me.lastName.trim()) missing.push('نام و نام خانوادگی');
    if (me.provinceId == null || me.cityId == null) missing.push('استان و شهر');
    if (!me.businessDesc || me.businessDesc.trim().length < 30) missing.push('معرفی کسب‌وکار');
    if (missing.length > 0) {
      tasks.push({
        key: 'profile',
        title: 'تکمیل پروفایل',
        description: `این بخش‌ها خالی است: ${missing.join('، ')} — پروفایل کامل اعتماد و دیده‌شدن شما را چند برابر می‌کند.`,
        href: '/panel/profile/edit',
        severity: 'info',
      });
    }

    // ─── ۴. اولین قدم فعال‌سازی — فروشنده: اولین آگهی؛ خریدارِ خالص: اولین
    //     درخواست خرید (فروشنده‌ها هم درخواست می‌توانند بزنند؛ نباید دوتایی نوک کند) ──
    if (me.isSeller && productCount === 0) {
      tasks.push({
        key: 'first_product',
        title: 'اولین آگهی کالای خود را ثبت کنید',
        description: 'تا وقتی آگهی ندارید، خریداران شما را پیدا نمی‌کنند — ثبت آگهی اولین قدم فروش در ایمچ است.',
        href: '/panel/products/new',
        severity: 'info',
      });
    }
    if (me.isBuyer && !me.isSeller && buyRequestCount === 0) {
      tasks.push({
        key: 'first_request',
        title: 'اولین درخواست خرید خود را ثبت کنید',
        description: 'درخواست خریدتان پس از تایید برای فروشندگانِ همان کالا ارسال می‌شود و پیشنهاد قیمت می‌گیرید.',
        href: '/panel/buy-requests/new',
        severity: 'info',
      });
    }

    // فوری‌ها اول — ترتیب نمایش لیست زنگوله
    const order: Record<TaskSeverity, number> = { urgent: 0, warning: 1, info: 2 };
    return tasks.sort((a, b) => order[a.severity] - order[b.severity]);
  }
}

/** پایان امروز به وقت سرور — همان قرارداد computeNextFollowAt در follow.service */
function endOfToday(): Date {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return end;
}

/** ارقام فارسی برای متن توضیح */
function toFa(n: number): string {
  return n.toLocaleString('fa-IR');
}
