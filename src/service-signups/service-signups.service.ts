import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import type { AuthUser } from '../common/guards';
import type { ServiceId, ServiceRole } from './dto';

/** نقش خوانده‌شده — ردیف‌های قدیمیِ بدون نقش، فروشنده حساب می‌شوند */
export type SignupRole = ServiceRole | 'both';

/** خروجی سبک — همان چیزی که فرم /services برای نمای «ثبت‌شده» لازم دارد */
export interface ServiceSignupRow {
  serviceId: ServiceId;
  role: SignupRole;
  guild: string;
  businessName: string;
  updatedAt: Date;
}

/** نرمال‌سازی نقش ذخیره‌شده — null/مقدار ناشناخته → فروشنده (ثبت‌های پیشین) */
function readRole(role: string | null | undefined): SignupRole {
  return role === 'buyer' || role === 'seller' || role === 'both' ? role : 'seller';
}

/**
 * ثبت‌نام در سرویس‌های تخصصی ایمچ برای فروش عمده (بازطراحی ۱۷-۱۱).
 *
 * صفحهٔ /services طرح‌های آیندهٔ ایمچ را معرفی می‌کند — فعلاً مرحلهٔ
 * ثبت‌نام و نیازسنجی است. هر سرویس دو دکمه دارد (خریدار/فروشنده)؛ هر
 * کاربر در هر سرویس یک رکورد دارد: اگر با نقش دوم هم اعلام علاقه کند،
 * نقش رکورد «both» می‌شود (ادغام، نه جایگزینی). مالک از پنل ادمین
 * ثبت‌نام‌کنندگان هر طرح را با نقش/صنف/کاتالوگ می‌بیند — شمار هر سرویس
 * سیگنال «کدام طرح را اول اجرا کنیم» است.
 */
@Injectable()
export class ServiceSignupsService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /service-signups/getMine — ثبت‌نام‌های کاربر جاری (وضعیت دکمه‌های /services) */
  async getMine(userId: AuthUser['id']): Promise<ServiceSignupRow[]> {
    const rows = await this.prisma.serviceSignup.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { serviceId: true, role: true, guild: true, businessName: true, updatedAt: true },
    });
    return rows.map((r) => ({ ...r, role: readRole(r.role) })) as ServiceSignupRow[];
  }

  /**
   * POST /service-signups/save — ثبت/اصلاح؛ هر کاربر در هر سرویس یک رکورد.
   * نقش: ثبت با نقش تکراری → همان نقش می‌ماند؛ با نقش متفاوت → «both».
   */
  async save(
    userId: AuthUser['id'],
    dto: { serviceId: ServiceId; role: ServiceRole; guild: string; businessName?: string },
  ): Promise<ServiceSignupRow> {
    const data = { guild: dto.guild.trim(), businessName: (dto.businessName ?? '').trim() };
    const existing = await this.prisma.serviceSignup.findUnique({
      where: { userId_serviceId: { userId, serviceId: dto.serviceId } },
      select: { role: true },
    });
    const prevRole = existing ? readRole(existing.role) : null;
    const role: SignupRole =
      prevRole && prevRole !== dto.role && prevRole !== 'both' ? 'both' : prevRole === 'both' ? 'both' : dto.role;
    const row = await this.prisma.serviceSignup.upsert({
      where: { userId_serviceId: { userId, serviceId: dto.serviceId } },
      update: { ...data, role },
      create: { userId, serviceId: dto.serviceId, role, ...data },
      select: { serviceId: true, role: true, guild: true, businessName: true, updatedAt: true },
    });
    return { ...row, role: readRole(row.role) } as ServiceSignupRow;
  }
}
