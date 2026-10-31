import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import {
  BillingConfig,
  DEFAULT_BILLING,
  customChargeMin,
  normalizeBilling,
} from './billing';

/**
 * ─── تنظیمات پویای سایت (سند واحد SiteSetting) ───────────────────────────────
 *
 * همه ماژول‌ها (wallet/buyers/…) هزینه‌ها را از این سرویس می‌خوانند — نه از
 * ثابت‌های کد. کش درون‌حافظه ۱۵ ثانیه‌ای: خواندنِ هر درخواست یک کوئری اضافه
 * به Atlas تحمیل نمی‌کند؛ نوشتن ادمین کش را فوری بیات می‌کند.
 */
@Injectable()
export class SiteSettingsService {
  private static CACHE_TTL_MS = 15_000;

  private cache: { value: BillingConfig; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** پیکربندی صورتحساب — سند نبود → با پیش‌فرضها ساخته می‌شود (idempotent) */
  async getBilling(): Promise<BillingConfig> {
    if (this.cache && Date.now() - this.cache.at < SiteSettingsService.CACHE_TTL_MS) {
      return this.cache.value;
    }
    let doc = await this.prisma.siteSetting.findUnique({ where: { id: 'main' } });
    if (!doc) {
      // مسابقه ساخت — برنده ذخیره می‌کند، بازنده مقدار موجود را می‌خواند
      doc = await this.prisma.siteSetting.upsert({
        where: { id: 'main' },
        create: { id: 'main', data: DEFAULT_BILLING as unknown as Prisma.InputJsonValue },
        update: {},
      });
    }
    const value = normalizeBilling(doc.data);
    this.cache = { value, at: Date.now() };
    return value;
  }

  /** نوشتن پیکربندی جدید (ادمین) — نرمال‌شده ذخیره می‌شود، کش بیات می‌شود */
  async updateBilling(raw: unknown, adminId: string): Promise<BillingConfig> {
    const value = normalizeBilling(raw);
    await this.prisma.siteSetting.upsert({
      where: { id: 'main' },
      create: { id: 'main', data: value as unknown as Prisma.InputJsonValue, updatedBy: adminId },
      update: { data: value as unknown as Prisma.InputJsonValue, updatedBy: adminId },
    });
    this.cache = { value, at: Date.now() };
    return value;
  }

  /** بیات کردن کش (بعد از هر تغییر) */
  invalidate(): void {
    this.cache = null;
  }

  /** شکل عمومی برای کلاینت — شامل حداقلِ محاسبه‌شدهٔ شارژ دلخواه */
  async publicBilling() {
    const cfg = await this.getBilling();
    return {
      ...cfg,
      customCharge: { ...cfg.customCharge, minAmount: customChargeMin(cfg) },
    };
  }
}
