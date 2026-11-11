import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import type { AuthUser } from '../common/guards';
import type { ServiceId } from './dto';

/** خروجی سبک — همان چیزی که فرم /services برای نمای «ثبت‌شده» لازم دارد */
export interface ServiceSignupRow {
  serviceId: ServiceId;
  guild: string;
  businessName: string;
  updatedAt: Date;
}

/**
 * ثبت‌نام فروشنده در سرویس‌های تخصصی ارزش‌افزوده (خواستهٔ مالک ۱۱-۱۲).
 *
 * نسخهٔ اول فرم فقط در حافظهٔ مرورگر فروشنده ذخیره می‌شد (پایلوت) — این
 * ماژول همان داده را به بک‌اند می‌آورد تا مالک از پنل ادمین ببیند هر
 * سرویس چند و چه کسانی ثبت‌نام کرده‌اند؛ شمار ثبت‌نام هر سرویس سیگنال
 * «کدام سرویس را اول راه‌اندازی کنیم» است.
 */
@Injectable()
export class ServiceSignupsService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /service-signups/getMine — ثبت‌نام‌های کاربر جاری (وضعیت باکس‌های /services) */
  async getMine(userId: AuthUser['id']): Promise<ServiceSignupRow[]> {
    const rows = await this.prisma.serviceSignup.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { serviceId: true, guild: true, businessName: true, updatedAt: true },
    });
    return rows as ServiceSignupRow[];
  }

  /** POST /service-signups/save — ثبت/اصلاح؛ هر کاربر در هر سرویس یک رکورد */
  async save(userId: AuthUser['id'], dto: { serviceId: ServiceId; guild: string; businessName: string }): Promise<ServiceSignupRow> {
    const data = { guild: dto.guild.trim(), businessName: dto.businessName.trim() };
    const row = await this.prisma.serviceSignup.upsert({
      where: { userId_serviceId: { userId, serviceId: dto.serviceId } },
      update: data,
      create: { userId, serviceId: dto.serviceId, ...data },
      select: { serviceId: true, guild: true, businessName: true, updatedAt: true },
    });
    return row as ServiceSignupRow;
  }
}
