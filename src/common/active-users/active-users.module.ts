import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module';
import { CacheService, TTL } from '../cache/cache.module';

/**
 * فیلتر «فروشندهٔ فعال» — جایگزین relation-filter پریسما (رفع کندی ۱۷-۱۱).
 *
 * `where: { user: { isActive: true } }` روی MongoDB به join سنگین سمت
 * درایور تبدیل می‌شود که با رشد User/Product خطی کند می‌شود — روی Atlas
 * (RTT ~۱۸۵ms) به ۲ تا ۴ ثانیه رسید و صفحهٔ لیست محصولات را فلج کرد؛
 * در حالی که کاربر غیرفعال تقریباً هیچ‌وقت وجود ندارد.
 *
 * این سرویس id کاربران غیرفعال را ۶۰ ثانیه کش می‌کند تا کوئری‌ها به‌جای
 * relation-filter از `userId: { notIn: [...] }` سبک استفاده کنند:
 * همان معنا (آگهیِ کاربر غیرفعال دیده نمی‌شود)، بدون join.
 *
 * ابطال: هر تغییر isActive در پنل ادمین تگ «users:active» را می‌بزد
 * (AdminUsersService) → فهرست در درخواست بعدی بازخوانی می‌شود.
 */
@Injectable()
export class ActiveUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** id کاربران غیرفعال (کش ۶۰ثانیه‌ای) */
  async inactiveUserIds(): Promise<string[]> {
    return this.cache.wrap(
      'users:inactive-ids',
      { ttlMs: TTL.MINUTE, tags: ['users:active'] },
      async () => {
        const rows = await this.prisma.user.findMany({
          where: { isActive: false },
          select: { id: true },
        });
        return rows.map((r) => r.id);
      },
    );
  }

  /** شرط آمادهٔ where — روی هر مدلی که userId ارجاع می‌دهد (Product، BuyRequest، …) */
  async activeUserWhere(): Promise<{ userId: { notIn: string[] } }> {
    return { userId: { notIn: await this.inactiveUserIds() } };
  }
}

@Global()
@Module({
  providers: [ActiveUsersService],
  exports: [ActiveUsersService],
})
export class ActiveUsersModule {}
