import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';
import { UpdateProfileDto } from './dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** نام استان/شهر از id عددی باسکول — کوئری‌های ایندکس‌دار سبک */
  private async locationNames(provinceId: number | null, cityId: number | null) {
    const [province, city] = await Promise.all([
      provinceId == null
        ? null
        : this.prisma.location.findUnique({ where: { id: `province:${provinceId}` } }),
      cityId == null
        ? null
        : this.prisma.location.findUnique({ where: { id: `city:${cityId}` } }),
    ]);
    return { provinceName: province?.name ?? null, cityName: city?.name ?? null };
  }

  /** POST /users/getProfile — پروفایل کامل کاربر جاری (احرازشده) */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.notFound('کاربر یافت نشد.');

    const [productCount, gallery, certificates] = await Promise.all([
      this.prisma.product.count({
        where: { userId, status: { in: ['confirmed', 'pending'] } },
      }),
      // تصاویر مربوطه/گواهی‌ها — همان اسلات‌هایی که فرم ویرایش پروفایل آپلود می‌کند
      this.prisma.file.findMany({
        where: { relatedModel: 'User', relatedId: userId, fieldKey: 'gallery' },
        orderBy: { createdAt: 'asc' },
        take: 12,
        select: { id: true, url: true, thumbUrl: true },
      }),
      this.prisma.file.findMany({
        where: { relatedModel: 'User', relatedId: userId, fieldKey: 'certificate' },
        orderBy: { createdAt: 'asc' },
        take: 8,
        select: { id: true, url: true, thumbUrl: true },
      }),
    ]);
    const { provinceName, cityName } = await this.locationNames(user.provinceId, user.cityId);

    return {
      user: {
        id: user.id,
        phone: user.phone,
        user_name: user.userName,
        first_name: user.firstName,
        last_name: user.lastName,
        sex: user.sex,
        role: user.role,
        /// فرانت با این پرچم بنر قرمز «رمز عبور تعیین کنید» را نشان می‌دهد
        has_password: Boolean(user.passwordHash),
        is_verified: user.isVerified,
        is_buyer: user.isBuyer,
        is_seller: user.isSeller,
        wallet_balance: user.walletBalance,
        avatar_url: user.avatarUrl,
        business_desc: user.businessDesc,
        province_id: user.provinceId,
        city_id: user.cityId,
        province: provinceName,
        city: cityName,
        product_count: productCount,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      },
      profile: user.profile ?? {},
      // تصاویر مربوطه + گواهی‌ها — برای فرم ویرایش و امتیاز کامل بودن پروفایل
      gallery: gallery.map((f) => ({ id: f.id, url: f.url, thumbUrl: f.thumbUrl ?? f.url })),
      certificates: certificates.map((f) => ({ id: f.id, url: f.url, thumbUrl: f.thumbUrl ?? f.url })),
    };
  }

  /** POST /users/updateProfile — ویرایش فیلدهای مجاز */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const current = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!current) throw AppError.notFound('کاربر یافت نشد.');

    const update: Record<string, unknown> = {};

    if (dto.first_name !== undefined) update.firstName = dto.first_name.trim();
    if (dto.last_name !== undefined) update.lastName = dto.last_name.trim();
    if (dto.sex !== undefined) update.sex = dto.sex;
    if (dto.is_buyer !== undefined) update.isBuyer = dto.is_buyer;
    if (dto.is_seller !== undefined) update.isSeller = dto.is_seller;
    if (dto.business_desc !== undefined) update.businessDesc = dto.business_desc.trim();
    if (dto.avatar_url !== undefined) update.avatarUrl = dto.avatar_url;

    // ─── مکان پیش‌فرض (استان/شهر) — اعتبارسنجی درخت لوکیشن ───
    if (dto.province_id !== undefined) {
      if (dto.province_id === null) {
        update.provinceId = null;
        update.cityId = null; // بدون استان، شهر هم معنی ندارد
      } else {
        const province = await this.prisma.location.findUnique({
          where: { id: `province:${dto.province_id}` },
        });
        if (!province || province.type !== 'province') {
          throw AppError.badRequest('استان انتخابی معتبر نیست.', 'BAD_PROVINCE');
        }
        update.provinceId = dto.province_id;
        // استان عوض شده و شهر جدید نیامده → شهر قبلی دیگر معتبر نیست
        if (dto.city_id === undefined && current.cityId != null && current.provinceId !== dto.province_id) {
          update.cityId = null;
        }
      }
    }
    if (dto.city_id !== undefined) {
      if (dto.city_id === null) {
        update.cityId = null;
      } else {
        const city = await this.prisma.location.findUnique({ where: { id: `city:${dto.city_id}` } });
        if (!city || city.type !== 'city') {
          throw AppError.badRequest('شهر انتخابی معتبر نیست.', 'BAD_CITY');
        }
        const effectiveProvince =
          (update.provinceId as number | null | undefined) ?? current.provinceId;
        if (effectiveProvince == null || city.parentId !== `province:${effectiveProvince}`) {
          throw AppError.badRequest('شهر به استان انتخابی تعلق ندارد.', 'CITY_PROVINCE_MISMATCH');
        }
        update.cityId = dto.city_id;
        // شهر آمده و استان نیامده → استان والد را خودکار ست کن (UX فرم‌ها)
        if (dto.province_id === undefined && current.provinceId == null) {
          update.provinceId = Number(city.parentId.split(':')[1]);
        }
      }
    }

    // پروفایل کسب‌وکار embedded — merge با مقادیر موجود (نه جایگزینی کامل)
    if (dto.profile !== undefined) {
      update.profile = { ...((current.profile as object) ?? {}), ...dto.profile };
    }

    await this.prisma.user.update({ where: { id: userId }, data: update });
    // کش پروفایل عمومی فروشنده (getSeller) بشکند تا ویرایش همان لحظه دیده شود
    const updated = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { userName: true },
    });
    if (updated?.userName) this.cache.invalidateTag(`seller:${updated.userName.trim()}`);
    return this.getProfile(userId);
  }
}
