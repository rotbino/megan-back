import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import { UpdateProfileDto } from './dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /users/getProfile — پروفایل کامل کاربر جاری (احرازشده) */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.notFound('کاربر یافت نشد.');

    const productCount = await this.prisma.product.count({
      where: { userId, status: { in: ['confirmed', 'pending'] } },
    });

    return {
      user: {
        id: user.id,
        phone: user.phone,
        user_name: user.userName,
        first_name: user.firstName,
        last_name: user.lastName,
        sex: user.sex,
        role: user.role,
        is_verified: user.isVerified,
        is_buyer: user.isBuyer,
        is_seller: user.isSeller,
        wallet_balance: user.walletBalance,
        avatar_url: user.avatarUrl,
        business_desc: user.businessDesc,
        product_count: productCount,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      },
      profile: user.profile ?? {},
    };
  }

  /** POST /users/updateProfile — ویرایش فیلدهای مجاز */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const update: Record<string, unknown> = {};

    if (dto.first_name !== undefined) update.firstName = dto.first_name.trim();
    if (dto.last_name !== undefined) update.lastName = dto.last_name.trim();
    if (dto.sex !== undefined) update.sex = dto.sex;
    if (dto.is_buyer !== undefined) update.isBuyer = dto.is_buyer;
    if (dto.is_seller !== undefined) update.isSeller = dto.is_seller;
    if (dto.business_desc !== undefined) update.businessDesc = dto.business_desc.trim();
    if (dto.avatar_url !== undefined) update.avatarUrl = dto.avatar_url;

    // پروفایل کسب‌وکار embedded — merge با مقادیر موجود (نه جایگزینی کامل)
    if (dto.profile !== undefined) {
      const existing = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { profile: true },
      });
      update.profile = { ...((existing?.profile as object) ?? {}), ...dto.profile };
    }

    await this.prisma.user.update({ where: { id: userId }, data: update });
    return this.getProfile(userId);
  }

  /** POST /users/getUserByPhone — اطلاعات عمومی حداقلی (بدون داده شخصی) */
  async getUserByPhone(phone: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) throw AppError.notFound('کاربری با این شماره یافت نشد.');
    return {
      id: user.id,
      user_name: user.userName,
      first_name: user.firstName,
      last_name: user.lastName,
      is_verified: user.isVerified,
      is_buyer: user.isBuyer,
      is_seller: user.isSeller,
      created_at: user.createdAt,
    };
  }
}
