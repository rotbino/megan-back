import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RefreshTokenDto, SendOtpDto, VerifyOtpDto } from './dto';
import { ok } from '../common/api-response';

const AUTH_THROTTLE = { default: { limit: 15, ttl: 60_000 } }; // سخت‌تر از حد سراسری

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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

  @Post('logout')
  @ApiOperation({ summary: 'خروج — ابطال رفرش‌توکن' })
  async logout(@Body() dto: RefreshTokenDto) {
    await this.auth.logout(dto.refreshToken);
    return ok(null, 'با موفقیت خارج شدید.');
  }
}
