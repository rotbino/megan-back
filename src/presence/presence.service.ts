import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';

/**
 * ─── حضور آنلاین/آفلاین کاربران ─────────────────────────────────────────────
 * منبع حقیقت: ستون user.last_seen_at (ماندگار بین ری‌استارت‌ها)؛ حافظه‌ی
 * درون‌پروسه‌ای نقش کش جلو-نویس دارد تا نبض‌های ۴۵ثانیه‌ای هر کاربر DB را
 * اذیت نکنند (نوشتن حداکثر هر ۳۰ ثانیه به‌ازای هر کاربر).
 *
 * «آنلاین» یعنی آخرین نبض تازه‌تر از پنجره ۹۰ ثانیه — دو ضربان از دست‌رفته
 * هنوز آنلاین می‌ماند (پرش شبکه/رفرش صفحه ناگهانی آفلاین نمی‌کند).
 *
 * منابع نبض: heartbeat ریز REST (هر ۴۵s)، اتصال/قطع WS چت، و ورود (login).
 */
export const ONLINE_WINDOW_MS = 90_000;
/** حداقل فاصله نوشتن last_seen_at در DB به‌ازای هر کاربر */
const DB_WRITE_THROTTLE_MS = 30_000;
/** عمر کش نتیجه DB برای کاربرانی که در حافظه نیستند */
const DB_CHECK_CACHE_MS = 15_000;

interface MemEntry {
  lastSeen: number;
  lastDbWrite: number;
}

@Injectable()
export class PresenceService {
  private readonly mem = new Map<string, MemEntry>();
  /** کش نتیجه استعلام DB — برای کاربرِ بدون ردیف حافظه */
  private readonly dbCache = new Map<string, { at: number; online: boolean; lastSeenAt: Date | null }>();

  constructor(private readonly prisma: PrismaService) {}

  /** نبض حضور — از heartbeat ریز، اتصال/قطع WS یا هر نقطه لمس دیگر */
  touch(userId: string): void {
    if (!userId) return;
    const now = Date.now();
    const entry = this.mem.get(userId);
    if (entry) {
      entry.lastSeen = now;
      if (now - entry.lastDbWrite >= DB_WRITE_THROTTLE_MS) {
        entry.lastDbWrite = now;
        void this.writeDb(userId, new Date(now));
      }
    } else {
      this.mem.set(userId, { lastSeen: now, lastDbWrite: now });
      void this.writeDb(userId, new Date(now));
    }
  }

  /** کاربر الان آنلاین است؟ — حافظه اول، DB با کش ۱۵ثانیه‌ای بعد */
  async isOnline(userId: string): Promise<boolean> {
    const entry = this.mem.get(userId);
    if (entry && Date.now() - entry.lastSeen < ONLINE_WINDOW_MS) return true;

    const cached = this.dbCache.get(userId);
    if (cached && Date.now() - cached.at < DB_CHECK_CACHE_MS) return cached.online;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lastSeenAt: true },
    });
    const online = Boolean(
      user?.lastSeenAt && Date.now() - user.lastSeenAt.getTime() < ONLINE_WINDOW_MS,
    );
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
    let rows: Array<{ id: string; userName: string; lastSeenAt: Date | null }> = [];
    if (input.userNames?.length) {
      rows = await this.prisma.user.findMany({
        where: { userName: { in: input.userNames } },
        select: { id: true, userName: true, lastSeenAt: true },
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
        select: { id: true, userName: true, lastSeenAt: true },
      });
      const seen = new Set(rows.map((r) => r.id));
      rows = [...rows, ...dbRows.filter((r) => !seen.has(r.id))];
    }

    return rows.map((r) => {
      const entry = this.mem.get(r.id);
      const memOnline = Boolean(entry && now - entry.lastSeen < ONLINE_WINDOW_MS);
      const dbOnline = Boolean(r.lastSeenAt && now - r.lastSeenAt.getTime() < ONLINE_WINDOW_MS);
      return { id: r.id, userName: r.userName, online: memOnline || dbOnline, lastSeenAt: r.lastSeenAt };
    });
  }

  /** شمار کاربران آنلاین — DB (حافظه بعد از ری‌استارت خالی است؛ DB ماندگار است) */
  async onlineCount(): Promise<number> {
    return this.prisma.user.count({
      where: { lastSeenAt: { gt: new Date(Date.now() - ONLINE_WINDOW_MS) } },
    });
  }

  private async writeDb(userId: string, at: Date): Promise<void> {
    try {
      await this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt: at } });
    } catch {
      /* کاربر حذف‌شده/غیرفعال — نبض بی‌اثر است */
    }
  }

  /** پاکسازی حافظه در خاموشی — ردیف‌ها دیگر لازم نیستند (DB منبع حقیقت است) */
  onModuleDestroy(): void {
    this.mem.clear();
    this.dbCache.clear();
  }
}
