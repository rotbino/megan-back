/**
 * وب‌پوش (B10) — ارسال اعلان به مرورگرها با استاندارد Web Push (VAPID).
 *
 * جریان: کلاینت با کلید عمومی سابسکرایب می‌شود (PushManager) و
 * {endpoint, p256dh, auth} را می‌فرستد؛ سرویس‌های دیگر (چت/...) از
 * sendToUser استفاده می‌کنند — گیرنده آفلاین اعلان سیستمی می‌بیند.
 * اشتراک منقضی (۴۱۰/۴۰۴) همان‌جا حذف می‌شود (بدون خطای کاربر).
 */

import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { PrismaService } from '../common/prisma/prisma.module';
import { env } from '../common/config/env';

/** شکل اعلان — با SW فرانت (sw.js) هم‌قرارداد */
export interface PushPayload {
  title: string;
  body: string;
  /** مسیر مقصد با کلیک — مثل /panel/messages */
  url?: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly configured: boolean;

  constructor(private readonly prisma: PrismaService) {
    // اگر کلیدها نیامده باشند، ماژول فعال نیست — سکوت کامل، مسیر اصلی نمی‌شکند
    this.configured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
    if (this.configured) {
      webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    } else {
      this.logger.warn('VAPID تنظیم نشده — وب‌پوش غیرفعال است (VAPID_PUBLIC_KEY/PRIVATE_KEY در .env)');
    }
  }

  /** کلید عمومی برای سابسکرایب کلاینت */
  publicKey(): string {
    return env.VAPID_PUBLIC_KEY;
  }

  /** POST /push/subscribe — upsert بر اساس endpoint (مرورگر جدید=ردیف تازه، ورود دوباره=مالک تازه) */
  async subscribe(
    userId: string,
    input: { endpoint: string; p256dh: string; auth: string; userAgent?: string },
  ): Promise<{ ok: true }> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      update: { userId, p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent ?? null },
      create: { userId, ...input },
    });
    return { ok: true };
  }

  /** POST /push/unsubscribe — فقط مالک خودش (یا endpoint منقضی از خود کلاینت) */
  async unsubscribe(userId: string, endpoint: string): Promise<{ ok: true }> {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
    return { ok: true };
  }

  /**
   * ارسال به همه دستگاه‌های یک کاربر — آتش‌وفراموش (never throws):
   * خطا/انقضای هر اشتراک فقط همان ردیف را می‌گیرد، مسیر فراخوان (مثل sendMessage) سالم می‌ماند.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.configured) return;
    let subs: { id: string; endpoint: string; p256dh: string; auth: string }[];
    try {
      subs = await this.prisma.pushSubscription.findMany({
        where: { userId },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
      });
    } catch {
      return; // دیتابیس موقتاً در دسترس نیست — اعلان حیاتی نیست
    }
    if (!subs.length) return;

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // ۴۱۰ Gone / ۴۰۴ — اشتراک مرده؛ بقیه خطاها (۴۲۹/۵۰۰) گذرا هستند
          if (status === 410 || status === 404) {
            await this.prisma.pushSubscription
              .delete({ where: { id: sub.id } })
              .catch(() => undefined);
          }
        }
      }),
    );
  }
}
