import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, LogoutDto, RefreshTokenDto, SendOtpDto, SetPasswordDto, VerifyOtpDto } from './dto';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../common/guards';
import { CurrentUser, MaybeCurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';

const AUTH_THROTTLE = { default: { limit: 15, ttl: 60_000 } }; // سخت‌تر از حد سراسری

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @ApiOperation({
    summary:
      'ورود/ثبت‌نام فقط با شماره موبایل (روش سشن — بدون پیامک). اگر رمز پنل تعیین شده باشد، رمز الزامی است.',
  })
  async login(@Body() dto: LoginDto) {
    return ok(await this.auth.loginWithSession(dto.phone, dto.password), 'خوش آمدید!');
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('setPassword')
  @ApiOperation({ summary: 'تعیین/تغییر رمز عبور پنل (اولین بار بدون رمز فعلی)' })
  async setPassword(@CurrentUser() user: { id: string }, @Body() dto: SetPasswordDto) {
    return ok(await this.auth.setPassword(user.id, dto.password, dto.currentPassword), 'رمز عبور پنل شما تعیین شد.');
  }

  // ── OTP — ساختار برای پنل پیامک آینده (فعلاً فرانت از login استفاده می‌کند) ──

  @Throttle(AUTH_THROTTLE)
  @Post('sendOtp')
  @ApiOperation({ summary: 'ارسال کد تایید ۵ رقمی به موبایل (سقف ۳ کد در ۱۰ دقیقه)' })
  async sendOtp(@Body() dto: SendOtpDto) {
    return ok(await this.auth.sendOtp(dto.phone), 'کد تایید ارسال شد.');
  }

  @Throttle(AUTH_THROTTLE)
  @Post('verifyOtp')
  @ApiOperation({ summary: 'تایید کد + ورود/ثبت‌نام خودکار (توکن‌ها را برمی‌گرداند)' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return ok(await this.auth.verifyOtp(dto.phone, dto.code), 'خوش آمدید!');
  }

  @Throttle(AUTH_THROTTLE)
  @Post('refreshToken')
  @ApiOperation({ summary: 'تمدید توکن‌ها با رفرش‌توکن (چرخشی)' })
  async refreshToken(@Body() dto: RefreshTokenDto) {
    return ok(await this.auth.refreshToken(dto.refreshToken));
  }

  /** خروج — با اکسس‌توکن (هدر) یا رفرش‌توکن (بدنه)؛ هر دو نبود هم موفق.
   *  سمت سرور همه نشست‌های کاربر را باطل می‌کند (لاگ‌اوت واقعی). */
  @UseGuards(OptionalJwtAuthGuard)
  @Post('logout')
  @ApiOperation({ summary: 'خروج — ابطال همه نشست‌ها سمت سرور (اکسس‌توکن + همه رفرش‌توکن‌ها)' })
  async logout(@MaybeCurrentUser() user: AuthUser | null, @Body() dto: LogoutDto) {
    await this.auth.logout(user?.id, dto.refreshToken);
    return ok(null, 'با موفقیت خارج شدید.');
  }
}
