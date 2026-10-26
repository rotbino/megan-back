import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService, TTL } from '../common/cache/cache.module';

/**
 * لوکیشن درختی واحد — یک کالکشن با type متمایز (province/city/region/…).
 *
 * کلید درخت رشتهٔ ترکیبی است: «province:4» / «city:230» — چون id های عددی
 * باسکول در دو فضای جدا هستند و برخورد دارند (شهر ۴=بستان‌آباد، استان ۴=اصفهان).
 * API ها همان id عددی خام باسکول را برمی‌گردانند تا فرانت/آگهی‌ها بدون تغییر
 * کار کنند؛ تبدیل فقط داخل همین سرویس است.
 */
@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** «4» → «province:4» */
  private key(type: string, buskolId: number): string {
    return `${type}:${buskolId}`;
  }

  /** عدد استان از کلید والد شهر («province:4» → 4) */
  private parentBuskolId(parentId: string | null): number | null {
    if (!parentId) return null;
    const n = Number(parentId.split(':')[1]);
    return Number.isFinite(n) ? n : null;
  }

  /** POST /locations/getAllProvinces — ۳۱ استان (کش‌شده) */
  async getAllProvinces() {
    return this.cache.wrap(
      'locations:provinces',
      { ttlMs: 10 * TTL.MINUTE, tags: ['base', 'locations'] },
      async () => {
        const list = await this.prisma.location.findMany({
          where: { type: 'province' },
          orderBy: { name: 'asc' },
        });
        return list.map((p) => ({
          id: p.buskolId,
          province_name: p.name,
          province_en_name: p.enName ?? null,
          country_id: 1,
          latitude: p.latitude ?? null,
          longitude: p.longitude ?? null,
        }));
      },
    );
  }

  /**
   * POST /locations/getCitiesByProvince — شهرهای یک استان؛
   * بدون province_id همه شهرها (برای فیلتر آبشاری «همه ایران» فرانت).
   */
  async getCitiesByProvince(provinceId: number | null) {
    return this.cache.wrap(
      `locations:cities:${provinceId}`,
      { ttlMs: 10 * TTL.MINUTE, tags: ['base', 'locations'] },
      async () => {
        const list = await this.prisma.location.findMany({
          where: {
            type: 'city',
            ...(provinceId != null ? { parentId: this.key('province', provinceId) } : {}),
          },
          orderBy: { name: 'asc' },
        });
        return list.map((c) => ({
          id: c.buskolId,
          province_id: this.parentBuskolId(c.parentId),
          city_name: c.name,
          city_en_name: c.enName ?? null,
          latitude: c.latitude ?? null,
          longitude: c.longitude ?? null,
        }));
      },
    );
  }

  /**
   * POST /locations/getLocationsByParent — فرزندان مستقیم یک گره درخت.
   * عمومی و type-آگنوستیک: برای پیمایش درخت از هر سطحی (استان → شهر →
   * منطقه → محله…) بدون افزودن اندپوینت جدید در آینده.
   * ورودی parent_id کلید ترکیبی است: «province:4» → شهرهای اصفهان.
   */
  async getLocationsByParent(parentId: string) {
    return this.cache.wrap(
      `locations:children:${parentId}`,
      { ttlMs: 10 * TTL.MINUTE, tags: ['base', 'locations'] },
      async () => {
        const list = await this.prisma.location.findMany({
          where: { parentId },
          orderBy: [{ type: 'asc' }, { name: 'asc' }],
        });
        return list.map((l) => ({
          id: l.id,
          buskool_id: l.buskolId,
          parent_id: l.parentId,
          name: l.name,
          en_name: l.enName ?? null,
          type: l.type,
          latitude: l.latitude ?? null,
          longitude: l.longitude ?? null,
        }));
      },
    );
  }

  /** یافتن گره لوکیشن (هر نوعی) با کلید ترکیبی */
  async getLocationByKey(key: string) {
    return this.prisma.location.findUnique({ where: { id: key } });
  }

  /** یافتن شهر با id عددی باسکول — برای denorm هنگام ثبت محصول/درخواست خرید */
  async getCityById(buskolId: number) {
    const hit = await this.prisma.location.findUnique({
      where: { id: this.key('city', buskolId) },
    });
    if (!hit || hit.type !== 'city') return null;
    return {
      id: hit.buskolId,
      province_id: this.parentBuskolId(hit.parentId),
      city_name: hit.name,
    };
  }

  /** یافتن استان با id عددی باسکول — برای denorm هنگام ثبت محصول/درخواست خرید */
  async getProvinceById(buskolId: number) {
    const hit = await this.prisma.location.findUnique({
      where: { id: this.key('province', buskolId) },
    });
    if (!hit || hit.type !== 'province') return null;
    return { id: hit.buskolId, province_name: hit.name };
  }
}
