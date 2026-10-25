import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { City, Province } from './schemas';
import { CacheService } from '../common/cache.service';

const CACHE_TTL_MS = 10 * 60 * 1000; // مکان‌ها به‌ندرت تغییر می‌کنند

@Injectable()
export class LocationsService {
  constructor(
    @InjectModel(Province.name) private readonly provinceModel: Model<Province>,
    @InjectModel(City.name) private readonly cityModel: Model<City>,
    private readonly cache: CacheService,
  ) {}

  /** POST /locations/getAllProvinces — ۳۱ استان (کش‌شده) */
  async getAllProvinces() {
    return this.cache.wrap('locations:provinces', CACHE_TTL_MS, async () => {
      const list = await this.provinceModel.find().sort({ province_name: 1 }).lean<Province[]>();
      return list.map((p) => ({
        id: p._id as number,
        province_name: p.province_name,
        province_en_name: p.province_en_name ?? null,
        country_id: p.country_id,
        latitude: p.latitude ?? null,
        longitude: p.longitude ?? null,
      }));
    });
  }

  /**
   * POST /locations/getCitiesByProvince — شهرهای یک استان؛
   * بدون province_id همه شهرها (برای فیلتر آبشاری «همه ایران» فرانت).
   */
  async getCitiesByProvince(provinceId: number | null) {
    return this.cache.wrap(`locations:cities:${provinceId}`, CACHE_TTL_MS, async () => {
      const query = provinceId != null ? { province_id: provinceId } : {};
      const list = await this.cityModel.find(query).sort({ city_name: 1 }).lean<City[]>();
      return list.map((c) => ({
        id: c._id as number,
        province_id: c.province_id,
        city_name: c.city_name,
        city_en_name: c.city_en_name ?? null,
        latitude: c.latitude ?? null,
        longitude: c.longitude ?? null,
      }));
    });
  }
}
