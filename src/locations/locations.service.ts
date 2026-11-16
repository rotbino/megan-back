import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService, TTL } from '../common/cache/cache.module';
import { ActiveUsersService } from '../common/active-users/active-users.module';

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
    private readonly activeUsers: ActiveUsersService,
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

  /** POST /locations/getAllProvinces — ۳۱ استان فعال (کش‌شده) */
  async getAllProvinces() {
    return this.cache.wrap(
      'locations:provinces',
      { ttlMs: 10 * TTL.MINUTE, tags: ['base', 'locations'] },
      async () => {
        const list = await this.prisma.location.findMany({
          where: { type: 'province', isActive: true },
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
            isActive: true,
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

  /**
   * POST /locations/getTopCities — شهرهای پربازار ایران به تعداد آگهی عمومی
   * (خواستهٔ مالک ۱۶-۱۱: «۵۰ شهری که بیشترین آگهی رو دارن بیار، از بیشترین
   * اول لیست» — باکس «بازار عمده شهرها» صفحهٔ اول).
   *
   * ⚠️ سورت سمت جاوااسکریپت: پرایسما+مونگو orderBy روی _count در groupBy را
   * بی‌صدا نادیده می‌گیرد (سنجش زندهٔ ۱۶-۱۱) ⇒ همهٔ گروه‌ها (چند صد ردیف
   * سبک cityId+count) گرفته می‌شوند، این‌جا نزولی سورت و برش می‌خورند.
   * نتیجه ۱۰ دقیقه کش و تگ products هر تغییر آگهی آن را تازه می‌کند —
   * صفحهٔ اول هیچ هزینهٔ اضافه‌ای نمی‌پردازد.
   */
  async getTopCities(limit: number) {
    const take = Math.min(Math.max(limit, 1), 100);
    return this.cache.wrap(
      `locations:top-cities:${take}`,
      { ttlMs: 10 * TTL.MINUTE, tags: ['products', 'locations'] },
      async () => {
        const grouped = await this.prisma.product.groupBy({
          by: ['cityId'],
          // همان فیلتر عمومی لیست‌ها (city-market/products) — آگهی نامرئی شمرده نمی‌شود
          where: { status: 'confirmed', ...(await this.activeUsers.activeUserWhere()) },
          _count: { _all: true },
        });
        // نزولی به تعداد آگهی، بعد برش به تعداد خواسته‌شده
        const top = grouped
          .sort((a, b) => b._count._all - a._count._all)
          .slice(0, Math.max(take * 2, take)); // کمی اضافه برای حذف شهرهای بی‌نام پایین‌تر
        if (top.length === 0) return [];
        const cityRows = await this.prisma.location.findMany({
          where: { type: 'city', buskolId: { in: top.map((g) => g.cityId) } },
          select: { buskolId: true, name: true, parentId: true, isActive: true },
        });
        const byId = new Map(cityRows.map((c) => [c.buskolId, c]));
        // فقط شهرهای موجود و فعال — آگهی‌های شهر پاک‌شده/غیرفعال بی‌نام می‌مانند
        return top
          .map((g) => {
            const loc = byId.get(g.cityId);
            if (!loc || !loc.isActive) return null;
            return {
              id: loc.buskolId,
              city_name: loc.name,
              province_id: this.parentBuskolId(loc.parentId),
              count: g._count._all,
            };
          })
          .filter((c): c is { id: number; city_name: string; province_id: number | null; count: number } => c !== null)
          .slice(0, take);
      },
    );
  }

  /** یافتن گره لوکیشن (هر نوعی) با کلید ترکیبی */
  async getLocationByKey(key: string) {
    return this.prisma.location.findUnique({ where: { id: key } });
  }

  /** یافتن شهر با id عددی باسکول — اعتبارسنجی فرم‌ها؛ is_active برای رد مکان غیرفعال */
  async getCityById(buskolId: number) {
    const hit = await this.prisma.location.findUnique({
      where: { id: this.key('city', buskolId) },
    });
    if (!hit || hit.type !== 'city') return null;
    return {
      id: hit.buskolId,
      province_id: this.parentBuskolId(hit.parentId),
      city_name: hit.name,
      is_active: hit.isActive,
    };
  }

  /** یافتن استان با id عددی باسکول — اعتبارسنجی فرم‌ها؛ is_active برای رد مکان غیرفعال */
  async getProvinceById(buskolId: number) {
    const hit = await this.prisma.location.findUnique({
      where: { id: this.key('province', buskolId) },
    });
    if (!hit || hit.type !== 'province') return null;
    return { id: hit.buskolId, province_name: hit.name, is_active: hit.isActive };
  }

  /**
   * نام‌های مکان برای join هنگام خواندن آگهی/درخواست —
   * یک کوئری برای همه استان‌ها و شهرهای درخواستی (denorm حذف شده).
   */
  async getNames(provinceIds: number[], cityIds: number[]) {
    const provs = new Map<number, string>();
    const cities = new Map<number, string>();
    const hasP = provinceIds.length > 0;
    const hasC = cityIds.length > 0;
    if (!hasP && !hasC) return { provinces: provs, cities };

    const rows = await this.prisma.location.findMany({
      where: {
        OR: [
          ...(hasP ? [{ type: 'province', buskolId: { in: provinceIds } }] : []),
          ...(hasC ? [{ type: 'city', buskolId: { in: cityIds } }] : []),
        ],
      },
      select: { type: true, buskolId: true, name: true },
    });
    for (const r of rows) {
      if (r.type === 'province') provs.set(r.buskolId, r.name);
      else if (r.type === 'city') cities.set(r.buskolId, r.name);
    }
    return { provinces: provs, cities };
  }
}
