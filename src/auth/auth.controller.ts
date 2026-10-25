import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RefreshTokenDto, SendOtpDto, VerifyOtpDto } from './dto';
import { ok } from '../common/api-response';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('sendOtp')
  @ApiOperation({ summary: 'ارسال کد تایید ۵ رقمی به موبایل' })
  async sendOtp(@Body() dto: SendOtpDto) {
    return ok(await this.auth.sendOtp(dto.phone), 'کد تایید ارسال شد.');
  }

  @Post('verifyOtp')
  @ApiOperation({ summary: 'تایید کد + ورود/ثبت‌نام خودکار (توکن‌ها را برمی‌گرداند)' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return ok(await this.auth.verifyOtp(dto.phone, dto.code), 'خوش آمدید!');
  }

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
