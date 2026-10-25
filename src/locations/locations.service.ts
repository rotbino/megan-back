import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService, TTL } from '../common/cache/cache.module';

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** POST /locations/getAllProvinces — ۳۱ استان (کش‌شده) */
  async getAllProvinces() {
    return this.cache.wrap(
      'locations:provinces',
      { ttlMs: 10 * TTL.MINUTE, tags: ['base', 'locations'] },
      async () => {
        const list = await this.prisma.province.findMany({ orderBy: { provinceName: 'asc' } });
        return list.map((p) => ({
          id: p.id,
          province_name: p.provinceName,
          province_en_name: p.provinceEnName ?? null,
          country_id: p.countryId,
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
        const list = await this.prisma.city.findMany({
          where: provinceId != null ? { provinceId } : undefined,
          orderBy: { cityName: 'asc' },
        });
        return list.map((c) => ({
          id: c.id,
          province_id: c.provinceId,
          city_name: c.cityName,
          city_en_name: c.cityEnName ?? null,
          latitude: c.latitude ?? null,
          longitude: c.longitude ?? null,
        }));
      },
    );
  }

  /** یافتن شهر در کش همه شهرها — برای denorm هنگام ثبت محصول */
  async getCityById(id: number) {
    const all = await this.getCitiesByProvince(null); // کش‌شده — همه شهرها
    const hit = all.find((c) => c.id === id);
    return hit ? { id: hit.id, province_id: hit.province_id, city_name: hit.city_name } : null;
  }

  /** یافتن استان در کش — برای denorm هنگام ثبت محصول */
  async getProvinceById(id: number) {
    const all = await this.getAllProvinces(); // کش‌شده
    const hit = all.find((p) => p.id === id);
    return hit ? { id: hit.id, province_name: hit.province_name } : null;
  }
}
