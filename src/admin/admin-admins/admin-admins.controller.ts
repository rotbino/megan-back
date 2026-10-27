import { Body, Controller, Post, SetMetadata, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminRolesGuard, ADMIN_ROLES_KEY } from '../admin-auth/admin-roles.guard';
import { AdminId } from '../admin-auth/admin-auth.controller';
import { AdminAdminsService } from './admin-admins.service';
import { ok } from '../../common/api-response';
import {
  CreateAdminDto,
  GetAdminListDto,
  ResetAdminPasswordDto,
  SetAdminActiveDto,
} from './dto';

/**
 * فاز A5 — مدیریت ادمین‌ها (admin/admins/*) — فقط SUPER_ADMIN.
 * گارد توکن وضعیت زنده را از DB می‌خواند؛ غیرفعال شدن = قفل فوری.
 */
@ApiTags('admin-admins')
@UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
@SetMetadata(ADMIN_ROLES_KEY, ['SUPER_ADMIN'])
@ApiBearerAuth()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('admin/admins')
export class AdminAdminsController {
  constructor(private readonly admins: AdminAdminsService) {}

  @Post('getAdminList')
  @ApiOperation({ summary: 'لیست ادمین‌ها + شمارش عملیات هرکدام' })
  async getAdminList(@Body() dto: GetAdminListDto) {
    return ok(await this.admins.getAdminList(dto));
  }

  @Post('createAdmin')
  @ApiOperation({ summary: 'ایجاد ادمین جدید — نام کاربری یکتا + نقش + رمز' })
  async createAdmin(@Body() dto: CreateAdminDto) {
    return ok(await this.admins.createAdmin(dto), 'ادمین جدید ساخته شد.');
  }

  @Post('setAdminActive')
  @ApiOperation({ summary: 'فعال/غیرفعال — قفل فوری (گارد وضعیت زنده می‌خواند)' })
  async setAdminActive(@AdminId() adminId: string, @Body() dto: SetAdminActiveDto) {
    return ok(
      await this.admins.setAdminActive(adminId, dto),
      dto.active ? 'حساب ادمین فعال شد.' : 'حساب ادمین غیرفعال شد.',
    );
  }

  @Post('resetAdminPassword')
  @ApiOperation({ summary: 'تنظیم مجدد رمز عبور ادمین' })
  async resetAdminPassword(@Body() dto: ResetAdminPasswordDto) {
    return ok(await this.admins.resetAdminPassword(dto), 'رمز عبور ادمین تغییر کرد.');
  }
}
