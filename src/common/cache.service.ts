/**
 * کش حافظه محلی با TTL — برای داده‌های عمومی کم‌تغییریر (دسته‌بندی‌ها، شهرها).
 * در محیط production چند-نمونه‌ای (multi-instance) این لایه را با Redis جایگزین کنید؛
 * اینترفیس همین می‌ماند و فقط Provider عوض می‌شود (اصل DIP).
 */
import { Injectable, Logger } from '@nestjs/common';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly store = new Map<string, Entry<unknown>>();

  async wrap<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key) as Entry<T> | undefined;
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const value = await loader();
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.logger.debug(`cache ${hit ? 'refreshed' : 'set'}: ${key} (ttl=${ttlMs}ms)`);
    return value;
  }

  invalidate(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
}
