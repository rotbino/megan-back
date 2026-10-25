import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { OtpCode, RefreshToken } from './schemas';
import { User } from '../users/schemas';

const OTP_TTL_SEC = 120; // ۲ دقیقه — مثل باسکول
const OTP_MAX_TRIES = 5; // حداکثر تلاش اشتباه برای هر کد
const OTP_RATE_WINDOW_MS = 10 * 60 * 1000; // پنجره rate limit
const OTP_RATE_MAX = 3; // حداکثر کد در هر پنجره

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** phone → timestamps درخواست‌های اخیر (rate limit درون‌حافظه‌ای) */
  private readonly otpRequests = new Map<string, number[]>();

  constructor(
    @InjectModel(OtpCode.name) private readonly otpModel: Model<OtpCode>,
    @InjectModel(RefreshToken.name) private readonly refreshModel: Model<RefreshToken>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** POST /auth/sendOtp — ساخت و «ارسال» کد ۵ رقمی */
  async sendOtp(phone: string) {
    this.assertRateLimit(phone);

    const code = String(Math.floor(10000 + Math.random() * 90000));
    // فقط آخرین کد هر شماره معتبر است
    await this.otpModel.deleteMany({ phone });
    await this.otpModel.create({
      phone,
      code_hash: sha256(`${phone}:${code}`),
      expires_at: new Date(Date.now() + OTP_TTL_SEC * 1000),
      tries: 0,
    });

    // TODO(B11): اتصال سرویس پیامک (کاوه‌نگار/…) — تا آن زمان فقط لاگ
    this.logger.log(`OTP ${phone} → ${code}`);

    const data: Record<string, unknown> = { phone, expiresIn: OTP_TTL_SEC };
    // در development کد در پاسخ برمی‌گردد تا بدون پنل پیامک قابل تست باشد
    if (this.config.get('NODE_ENV') === 'development') data.devCode = code;
    return data;
  }

  /** POST /auth/verifyOtp — تایید کد + ورود/ثبت‌نام خودکار + صدور توکن‌ها */
  async verifyOtp(phone: string, code: string) {
    const otp = await this.otpModel.findOne({ phone }).sort({ created_at: -1 });
    if (!otp) {
      throw new BadRequestException({
        message: 'کد تاییدی برای این شماره یافت نشد؛ دوباره درخواست کنید.',
        code: 'OTP_NOT_FOUND',
      });
    }
    if (otp.expires_at.getTime() < Date.now()) {
      await this.otpModel.deleteOne({ _id: otp._id });
      throw new BadRequestException({
        message: 'کد تایید منقضی شده است؛ کد جدید بگیرید.',
        code: 'OTP_EXPIRED',
      });
    }
    if (otp.tries >= OTP_MAX_TRIES) {
      await this.otpModel.deleteOne({ _id: otp._id });
      throw new BadRequestException({
        message: 'تعداد تلاش‌های نامعتبر زیاد است؛ کد جدید بگیرید.',
        code: 'OTP_LOCKED',
      });
    }
    if (otp.code_hash !== sha256(`${phone}:${code}`)) {
      otp.tries += 1;
      await otp.save();
      throw new BadRequestException({
        message: 'کد تایید نادرست است.',
        code: 'OTP_WRONG',
      });
    }

    // کد صحیح → مصرف و یافتن/ساخت کاربر (ورود و ثبت‌نام یک جاست — مثل باسکول)
    await this.otpModel.deleteOne({ _id: otp._id });
    let user = await this.userModel.findOne({ phone });
    const isNewUser = !user;
    if (!user) {
      user = await this.userModel.create({ phone });
    }

    const tokens = await this.issueTokens(user);
    return { isNewUser, user: this.publicUser(user), ...tokens };
  }

  /** POST /auth/refreshToken — چرخش رفرش‌توکن */
  async refreshToken(refreshToken: string) {
    const doc = await this.refreshModel.findOne({
      token_hash: sha256(refreshToken),
      revoked: false,
    });
    if (!doc || doc.expires_at.getTime() < Date.now()) {
      throw new UnauthorizedException({
        message: 'نشست شما منقضی شده است؛ دوباره وارد شوید.',
        code: 'REFRESH_INVALID',
      });
    }
    const user = await this.userModel.findById(doc.user_id);
    if (!user) {
      throw new UnauthorizedException({
        message: 'کاربر یافت نشد؛ دوباره وارد شوید.',
        code: 'USER_NOT_FOUND',
      });
    }
    // چرخش: قدیمی باطل، جفت جدید صادر
    doc.revoked = true;
    await doc.save();
    return this.issueTokens(user);
  }

  /** POST /auth/logout — ابطال رفرش‌توکن */
  async logout(refreshToken: string): Promise<void> {
    await this.refreshModel.updateOne(
      { token_hash: sha256(refreshToken) },
      { $set: { revoked: true } },
    );
  }

  // ── داخلی ──────────────────────────────────────────────

  private async issueTokens(user: User) {
    const accessToken = await this.jwt.signAsync({
      sub: String(user._id),
      phone: user.phone,
    });
    const refreshToken = randomBytes(32).toString('hex');
    const ttlDays = Number(this.config.get('REFRESH_TOKEN_TTL_DAYS') ?? 30);
    await this.refreshModel.create({
      user_id: user._id as Types.ObjectId,
      token_hash: sha256(refreshToken),
      expires_at: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
    });
    return { accessToken, refreshToken, expiresIn: this.config.get('JWT_EXPIRES_IN') ?? '7d' };
  }

  private assertRateLimit(phone: string): void {
    const now = Date.now();
    const recent = (this.otpRequests.get(phone) ?? []).filter(
      (t) => now - t < OTP_RATE_WINDOW_MS,
    );
    if (recent.length >= OTP_RATE_MAX) {
      throw new BadRequestException({
        message: 'درخواست کد بیش از حد مجاز؛ چند دقیقه دیگر تلاش کنید.',
        code: 'OTP_RATE_LIMITED',
      });
    }
    recent.push(now);
    this.otpRequests.set(phone, recent);
  }

  /** فیلدهای امن برای پاسخ‌های auth */
  publicUser(user: User) {
    return {
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
      created_at: user.created_at,
    };
  }
}
