import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminActionsService } from './admin-actions.service';
import { ok } from '../../common/api-response';
import { GetAdminActionsDto } from './dto';

/**
 * فاز A5 — لاگ عملیات‌های ادمین (admin/actions/*).
 * فقط خواندنی؛ ثبت خودکار توسط AdminActionInterceptor انجام می‌شود.
 */
@ApiTags('admin-actions')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/actions')
export class AdminActionsController {
  constructor(private readonly actions: AdminActionsService) {}

  @Post('getAdminActions')
  @ApiOperation({ summary: 'لاگ عملیات ادمین‌ها — فیلتر ادمین/مسیر/نوع هدف/تاریخ' })
  async getAdminActions(@Body() dto: GetAdminActionsDto) {
    return ok(await this.actions.getAdminActions(dto));
  }
}
