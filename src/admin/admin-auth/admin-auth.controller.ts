import {
  Body,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthService } from './admin-auth.service';
import { AdminChangePasswordDto, AdminLoginDto } from './dto';
import { AdminJwtAuthGuard } from './admin-jwt.guard';
import { ok } from '../../common/api-response';

/** حد نرخ ورود ادمین — سخت‌ترین حد API */
const ADMIN_AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/** دکوراتور سبک — id ادمین احرازشده از request (گذاشته‌شده توسط گارد) */
export const AdminId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ adminId?: string }>();
  return request.adminId ?? '';
});

@ApiTags('admin-auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Throttle(ADMIN_AUTH_THROTTLE)
  @Post('login')
  @ApiOperation({ summary: 'ورود پنل مدیریت — نام کاربری + رمز عبور' })
  async login(@Body() dto: AdminLoginDto) {
    return ok(await this.adminAuth.login(dto.username, dto.password), 'به پنل مدیریت خوش آمدید.');
  }

  @UseGuards(AdminJwtAuthGuard)
  @ApiBearerAuth()
  @Post('me')
  @ApiOperation({ summary: 'اطلاعات ادمین جاری' })
  async me(@AdminId() adminId: string) {
    return ok(await this.adminAuth.me(adminId));
  }

  @UseGuards(AdminJwtAuthGuard)
  @ApiBearerAuth()
  @Post('changePassword')
  @ApiOperation({ summary: 'تغییر رمز عبور مدیریت خود (با رمز فعلی)' })
  async changePassword(@AdminId() adminId: string, @Body() dto: AdminChangePasswordDto) {
    await this.adminAuth.changePassword(adminId, dto.currentPassword, dto.newPassword);
    return ok(null, 'رمز عبور مدیریت تغییر کرد.');
  }

  @UseGuards(AdminJwtAuthGuard)
  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({ summary: 'خروج — توکن stateless؛ حذف سمت کلاینت کافی است' })
  async logout() {
    await this.adminAuth.logout();
    return ok(null, 'با موفقیت خارج شدید.');
  }
}
