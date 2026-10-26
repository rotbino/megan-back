import { Body, Controller, Post, UseGuards, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminId } from '../admin-auth/admin-auth.controller';
import { AdminUsersService } from './admin-users.service';
import { ok } from '../../common/api-response';
import {
  CreditWalletDto,
  GetUserListDto,
  ReviewVerificationAdminDto,
  SetUserActiveDto,
  SetUserRolesDto,
  UserIdDto,
} from './dto';

/** نام کاربری ادمین از توکن — برای ثبت بررسی‌کننده در احراز اسناد */
export const AdminUsername = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ adminUsername?: string }>();
    return request.adminUsername ?? '';
  },
);

/**
 * فاز A3 — مدیریت کاربران (admin/users/*).
 * فقط POST JSON با قرارداد یکنواخت؛ همه محافظت‌شده با AdminJwtAuthGuard
 * (توکن کاربر عادی اینجا هرگز قبول نمی‌شود — راز جدا + scope='admin').
 */
@ApiTags('admin-users')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Post('getUserList')
  @ApiOperation({ summary: 'لیست کاربران — جستجو/فیلتر نقش-وضعیت-احراز + صفحه‌بندی' })
  async getUserList(@Body() dto: GetUserListDto) {
    return ok(await this.users.getUserList(dto));
  }

  @Post('getUserDetail')
  @ApiOperation({ summary: 'جزئیات کامل کاربر — پروفایل + آمار + آگهی‌ها + کیف پول + احراز' })
  async getUserDetail(@Body() dto: UserIdDto) {
    return ok(await this.users.getUserDetail(dto.id));
  }

  @Post('setUserActive')
  @ApiOperation({ summary: 'فعال/غیرفعال — ورود مسدود، نشست‌ها باطل، محتوا پنهان (حذف نرم)' })
  async setUserActive(@AdminId() adminId: string, @Body() dto: SetUserActiveDto) {
    return ok(
      await this.users.setUserActive(adminId, dto),
      dto.active ? 'حساب کاربر فعال شد.' : 'حساب کاربر غیرفعال و نشست‌هایش باطل شد.',
    );
  }

  @Post('setUserRoles')
  @ApiOperation({ summary: 'تغییر نقش خریدار/فروشنده کاربر' })
  async setUserRoles(@Body() dto: SetUserRolesDto) {
    return ok(await this.users.setUserRoles(dto), 'نقش‌های کاربر به‌روز شد.');
  }

  @Post('creditWallet')
  @ApiOperation({ summary: 'شارژ/کسر دستی کیف پول با دلیل (مثبت=شارژ، منفی=کسر)' })
  async creditWallet(@AdminId() adminId: string, @Body() dto: CreditWalletDto) {
    return ok(await this.users.creditWallet(adminId, dto), 'کیف پول کاربر اصلاح شد.');
  }

  @Post('reviewVerification')
  @ApiOperation({ summary: 'بازبینی مدارک احراز هویت — تأیید یا رد با دلیل' })
  async reviewVerification(
    @AdminUsername() adminUsername: string,
    @AdminId() adminId: string,
    @Body() dto: ReviewVerificationAdminDto,
  ) {
    return ok(
      await this.users.reviewVerification(adminId, adminUsername, dto),
      dto.approve ? 'هویت کاربر تأیید شد.' : 'درخواست احراز رد شد.',
    );
  }
}
