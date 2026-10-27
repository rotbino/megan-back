import { Global, Injectable, Module } from '@nestjs/common';

/**
 * کش درون‌حافظه با TTL + ابطال تگ‌دار + تخلیه LRU (پورت از imach-back).
 *
 * راهبرد:
 *  • داده‌های مرجع کم‌تغییر (دسته‌ها، استان‌ها) → TTL بلند، تگ «base».
 *  • لیست‌های عمومی/پروفایل‌ها → TTL کوتاه، تگ per-entity.
 *  • هر mutation تگ‌هایی را که لمس کرده ابطال می‌کند → خواندن بیات بعد از نوشتن وجود ندارد.
 *
 * عمداً بدون وابستگی؛ همین اینترفیس ۱:۱ روی Redis نقشه می‌شود وقتی مقیاس افقی لازم شد.
 */

interface Entry {
  value: unknown;
  expiresAt: number;
  tags: readonly string[];
}

const MAX_ENTRIES = 5_000;

@Injectable()
export class CacheService {
  private store = new Map<string, Entry>();
  private hits = 0;
  private misses = 0;

  /** Get-or-load. گزینه‌ها: ttlMs + tags (برای ابطال گروهی). */
  async wrap<T>(
    key: string,
    opts: { ttlMs: number; tags?: readonly string[] },
    loader: () => Promise<T>,
  ): Promise<T> {
    const now = Date.now();
    const found = this.store.get(key);

    if (found && found.expiresAt > now) {
      // تازه‌سازی LRU
      this.store.delete(key);
      this.store.set(key, found);
      this.hits++;
      return found.value as T;
    }

    this.misses++;
    const value = await loader();
    this.store.set(key, { value, expiresAt: now + opts.ttlMs, tags: opts.tags ?? [] });
    this.evictIfNeeded();
    return value;
  }

  /** ابطال یک کلید دقیق. */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** ابطال همه‌ی ورودی‌های حامل تگ داده‌شده. */
  invalidateTag(tag: string): void {
    for (const [key, entry] of this.store) {
      if (entry.tags.includes(tag)) this.store.delete(key);
    }
  }

  stats(): { size: number; hits: number; misses: number; hitRatio: number } {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRatio: total === 0 ? 0 : Math.round((this.hits / total) * 100),
    };
  }

  private evictIfNeeded(): void {
    while (this.store.size > MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}

/** TTLهای استاندارد (میلی‌ثانیه) */
export const TTL = {
  MINUTE: 60_000,
  SHORT: 30_000,
  FIVE_MIN: 5 * 60_000,
  HOUR: 60 * 60_000,
} as const;

@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
