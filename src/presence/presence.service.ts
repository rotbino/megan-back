import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma/prisma.module';

/**
 * ─── حضور آنلاین/آفلاین کاربران (v2 — واقعی، نه «لاگین است = آنلاین») ───────
 *
 * منبع حقیقت: دو ستون user.last_seen_at + user.offline_at (ماندگار بین
 * ری‌استارت‌ها). حافظه‌ی درون‌پروسه‌ای نقش کش جلو-نویس دارد.
 *
 * «آنلاین» = last_seenAt تازه‌تر از پنجره ۹۰s «و» خروج صریح نداشتن:
 *  • touch (نبض ۴۵s / اتصال WS / ورود) → last_seen_at=now, offline_at=null
 *  • markDeparted (بستن صفحه/لاگ‌اوت/قطع آخرین سوکت/انقضای نشست) →
 *    هر دو = now → همان لحظه آفلاین، بدون انتظار پیرشدن پنجره.
 *
 * منابع خروج: بیکن leave کلاینت در pagehide (حتی با توکن منقضی — امضا
 * معتبر کافی است)، قطعِ آخرین سوکت WS (شمارنده اتصال per-user)، و
 * forceUserDeparture از لاگ‌اوت/غیرفعال‌سازی ادمین.
 */
export const ONLINE_WINDOW_MS = 90_000;
/** حداقل فاصله نوشتن last_seen_at در DB به‌ازای هر کاربر */
const DB_WRITE_THROTTLE_MS = 30_000;
/** عمر کش نتیجه DB برای کاربرانی که در حافظه نیستند */
const DB_CHECK_CACHE_MS = 15_000;
/** پاکسازی دوره‌ای حافظه — ردیف‌های خوابیده حذف می‌شوند (منبع حقیقت DB است) */
const MEM_SWEEP_MS = 5 * 60_000;
const MEM_SWEEP_MAX_AGE_MS = 10 * 60_000;

interface MemEntry {
  lastSeen: number;
  lastDbWrite: number;
  /** مهر خروج در حافظه — مقدم بر DB (نوشتن DB ممکن است دریافتی نباشد) */
  departedAt: number | null;
}

@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly mem = new Map<string, MemEntry>();
  /** کش نتیجه استعلام DB — برای کاربرِ بدون ردیف حافظه */
  private readonly dbCache = new Map<string, { at: number; online: boolean; lastSeenAt: Date | null }>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  onModuleInit(): void {
    this.sweepTimer = setInterval(() => this.sweepMem(), MEM_SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.mem.clear();
    this.dbCache.clear();
  }

  /** نبض حضور — heartbeat ریز، اتصال WS، ورود یا هر نقطه لمس دیگر.
   *  خروج قبلی را نیز پاک می‌کند (کاربر برگشته). */
  touch(userId: string): void {
    if (!userId) return;
    const now = Date.now();
    const entry = this.mem.get(userId);
    const wasDeparted = entry?.departedAt != null;
    if (entry) {
      entry.lastSeen = now;
      entry.departedAt = null;
      // خروجِ قبلی → همین حالا در DB هم پاک شود (بدون throttle)
      if (wasDeparted || now - entry.lastDbWrite >= DB_WRITE_THROTTLE_MS) {
        entry.lastDbWrite = now;
        void this.writeDb(userId, { lastSeenAt: new Date(now), offlineAt: null });
      }
    } else {
      this.mem.set(userId, { lastSeen: now, lastDbWrite: now, departedAt: null });
      void this.writeDb(userId, { lastSeenAt: new Date(now), offlineAt: null });
    }
    this.dbCache.delete(userId);
  }

  /** خروج صریح — بستن صفحه/لاگ‌اوت/قطع آخرین سوکت. فوری آفلاین می‌کند؛
   *  last_seen_at لحظه‌ی خروج می‌شود («آخرین بازدید» همان لحظه رفتن است). */
  markDeparted(userId: string): void {
    if (!userId) return;
    const now = Date.now();
    const entry = this.mem.get(userId);
    if (entry) {
      entry.lastSeen = now;
      entry.departedAt = now;
      entry.lastDbWrite = now;
    } else {
      this.mem.set(userId, { lastSeen: now, lastDbWrite: now, departedAt: now });
    }
    void this.writeDb(userId, { lastSeenAt: new Date(now), offlineAt: new Date(now) });
    this.dbCache.delete(userId);
  }

  /** توکن JWT برای بیکن خروج — امضا معتبر ولی منقضی هم پذیرفته می‌شود:
   *  وقتی نشست سرور-side تمام شده کلاینت فقط همین توکن را دارد و باید
   *  بتواند خودش را آفلاین کند (امضا هویت را ثابت می‌کند — کافی است). */
  async verifyDepartingToken(token: string): Promise<string | null> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        ignoreExpiration: true,
      });
      return payload?.sub ?? null;
    } catch {
      return null;
    }
  }

  /** کاربر الان آنلاین است؟ — حافظه اول (خروج در حافظه = قطعی)، DB با کش ۱۵ثانیه‌ای بعد */
  async isOnline(userId: string): Promise<boolean> {
    const entry = this.mem.get(userId);
    if (entry) {
      if (entry.departedAt != null) return false; // خروج صریح — مقدم بر هر چیز
      return Date.now() - entry.lastSeen < ONLINE_WINDOW_MS;
    }

    const cached = this.dbCache.get(userId);
    if (cached && Date.now() - cached.at < DB_CHECK_CACHE_MS) return cached.online;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lastSeenAt: true, offlineAt: true },
    });
    const online = this.dbOnline(user?.lastSeenAt, user?.offlineAt);
    this.dbCache.set(userId, { at: Date.now(), online, lastSeenAt: user?.lastSeenAt ?? null });
    return online;
  }

  /**
   * وضعیت گروهی — برای صفحات عمومی (کارت فروشنده آگهی/پروفایل/چت).
   * ترتیب ورودی حفظ نمی‌شود؛ کلاینت با id/userName نگاشت می‌کند.
   */
  async statuses(input: {
    ids?: string[];
    userNames?: string[];
  }): Promise<Array<{ id: string; userName: string; online: boolean; lastSeenAt: Date | null }>> {
    const now = Date.now();

    // ۱) رزولو شناسه‌ها — userName → User (id + lastSeenAt در همان پاس)
    let rows: Array<{ id: string; userName: string; lastSeenAt: Date | null; offlineAt: Date | null }> = [];
    if (input.userNames?.length) {
      rows = await this.prisma.user.findMany({
        where: { userName: { in: input.userNames } },
        select: { id: true, userName: true, lastSeenAt: true, offlineAt: true },
      });
    }
    const byName = new Map(rows.map((r) => [r.userName, r]));
    const ids: string[] = [
      ...(input.ids ?? []),
      ...(input.userNames ?? []).map((n) => byName.get(n)?.id).filter((x): x is string => !!x),
    ];

    if (ids.length) {
      const dbRows = await this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, userName: true, lastSeenAt: true, offlineAt: true },
      });
      const seen = new Set(rows.map((r) => r.id));
      rows = [...rows, ...dbRows.filter((r) => !seen.has(r.id))];
    }

    return rows.map((r) => {
      const entry = this.mem.get(r.id);
      const online = entry
        ? entry.departedAt == null && now - entry.lastSeen < ONLINE_WINDOW_MS
        : this.dbOnline(r.lastSeenAt, r.offlineAt);
      return { id: r.id, userName: r.userName, online, lastSeenAt: r.lastSeenAt };
    });
  }

  /** شناسه‌های آنلاین — DB ∪ حافظه، منهای خروج‌ها؛ برای فیلتر/شمار ادمین. */
  async onlineIds(): Promise<string[]> {
    const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
    const dbRows = await this.prisma.user.findMany({
      where: { lastSeenAt: { gt: cutoff } },
      select: { id: true, offlineAt: true },
    });

    const online = new Set<string>();
    for (const r of dbRows) {
      if (!r.offlineAt) online.add(r.id);
    }
    // حافظه مقدم است: خروج تازه (نوشتن DB هنوز دریافتی) حذف می‌کند؛
    // نبض تازه (throttle نوشتن) اضافه می‌کند
    for (const [id, entry] of this.mem) {
      if (Date.now() - entry.lastSeen >= ONLINE_WINDOW_MS) continue;
      if (entry.departedAt != null) online.delete(id);
      else online.add(id);
    }
    return [...online];
  }

  /** شمار کاربران آنلاین — هم‌خط با onlineIds (خروج‌های صریح کم می‌شوند) */
  async onlineCount(): Promise<number> {
    return (await this.onlineIds()).length;
  }

  // ─── داخلی ─────────────────────────────────────────────────────────────────

  /** قاعده DB: آنلاین = lastSeenAt تازه و بدون مهر خروج */
  private dbOnline(lastSeenAt: Date | null | undefined, offlineAt: Date | null | undefined): boolean {
    if (!lastSeenAt) return false;
    if (Date.now() - lastSeenAt.getTime() >= ONLINE_WINDOW_MS) return false;
    return !offlineAt; // touch همیشه null می‌کند → وجودش یعنی خروج
  }

  private async writeDb(userId: string, data: { lastSeenAt: Date; offlineAt: Date | null }): Promise<void> {
    try {
      await this.prisma.user.update({ where: { id: userId }, data });
    } catch {
      /* کاربر حذف‌شده/غیرفعال — نبض بی‌اثر است */
    }
  }

  /** حافظه را کوچک نگه می‌دارد — ردیف‌های به‌شدت قدیمی حذف (DB حقیقت است) */
  private sweepMem(): void {
    const horizon = Date.now() - MEM_SWEEP_MAX_AGE_MS;
    for (const [id, entry] of this.mem) {
      if (entry.lastSeen < horizon) this.mem.delete(id);
    }
    for (const [id, c] of this.dbCache) {
      if (Date.now() - c.at >= DB_CHECK_CACHE_MS * 4) this.dbCache.delete(id);
    }
  }
}
