import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { User } from './schemas';
import { UpdateProfileDto } from './dto';

const USERNAME_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // بدون حروف گیج‌کننده مثل l/1/O/0

/** شناسه عمومی پروفایل مثل باسکول (مثل wbrstu2g1) */
function generateUserName(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => USERNAME_ALPHABET[b % USERNAME_ALPHABET.length]).join('');
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {}

  /** POST /users/getProfile — پروفایل کامل کاربر جاری (احراز شده) */
  async getProfile(userId: string) {
    const user = await this.userModel.findById(userId).lean<User & { _id: unknown }>();
    if (!user) {
      throw new NotFoundException({ message: 'کاربر یافت نشد.', code: 'USER_NOT_FOUND' });
    }
    return {
      user: {
        id: String(user._id),
        phone: user.phone,
        user_name: user.user_name ?? null,
        first_name: user.first_name,
        last_name: user.last_name,
        sex: user.sex ?? null,
        role: user.role,
        is_verified: user.is_verified,
        is_buyer: user.is_buyer,
        is_seller: user.is_seller,
        wallet_balance: user.wallet_balance,
        avatar_url: user.avatar_url ?? null,
        business_desc: user.business_desc ?? null,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      profile: user.profile ?? {},
    };
  }

  /** POST /users/updateProfile — ویرایش فیلدهای مجاز + تولید user_name در اولین تکمیل */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const update: Record<string, unknown> = {};

    if (dto.first_name !== undefined) update.first_name = dto.first_name.trim();
    if (dto.last_name !== undefined) update.last_name = dto.last_name.trim();
    if (dto.sex !== undefined) update.sex = dto.sex;
    if (dto.is_buyer !== undefined) update.is_buyer = dto.is_buyer;
    if (dto.is_seller !== undefined) update.is_seller = dto.is_seller;
    if (dto.business_desc !== undefined) update.business_desc = dto.business_desc.trim();
    if (dto.avatar_url !== undefined) update.avatar_url = dto.avatar_url;

    // پروفایل کسب‌وکار embedded — merge با مقادیر موجود (نه جایگزینی کامل)
    if (dto.profile !== undefined) {
      const existing = await this.userModel
        .findById(userId)
        .select('profile')
        .lean<{ profile?: Record<string, unknown> }>();
      update.profile = { ...(existing?.profile ?? {}), ...dto.profile };
    }

    // با اولین وارد کردن نام، شناسه عمومی پروفایل تولید می‌شود (مثل باسکول)
    const naming =
      (dto.first_name !== undefined && dto.first_name.trim() !== '') ||
      (dto.last_name !== undefined && dto.last_name.trim() !== '');
    if (naming) {
      const current = await this.userModel.findById(userId).select('user_name').lean();
      if (!current?.user_name) update.user_name = generateUserName();
    }

    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: update },
      { new: true },
    );
    if (!user) {
      throw new NotFoundException({ message: 'کاربر یافت نشد.', code: 'USER_NOT_FOUND' });
    }
    return this.getProfile(userId);
  }

  /** POST /users/getUserByPhone — اطلاعات عمومی حداقلی (بدون داده شخصی) */
  async getUserByPhone(phone: string) {
    const user = await this.userModel.findOne({ phone }).lean<User & { _id: unknown }>();
    if (!user) {
      throw new NotFoundException({
        message: 'کاربری با این شماره یافت نشد.',
        code: 'USER_NOT_FOUND',
      });
    }
    return {
      id: String(user._id),
      user_name: user.user_name ?? null,
      first_name: user.first_name,
      last_name: user.last_name,
      is_verified: user.is_verified,
      is_buyer: user.is_buyer,
      is_seller: user.is_seller,
      created_at: user.created_at,
    };
  }
}
