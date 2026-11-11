import { Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';
import { TasksService } from './tasks.service';

/**
 * تسک‌های کاربر — کارهای مهمی که باید انجام دهد و هنوز انجام نشده
 * (خواستهٔ مالک ۱۱-۱۱ دور ۴: زنگولهٔ اعلان + لیست «تا انجام نده غیب نمی‌شود»).
 */
@ApiTags('tasks')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
/** بج زنگوله هر ۶۰ ثانیه poll می‌شود — حد نرخ بالاتر از پیش‌فرض سراسری */
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post('getMyTasks')
  @ApiOperation({ summary: 'کارهای مهم ماندهٔ من — سرنخ‌های سررسیده، احراز هویت، تکمیل پروفایل، اولین آگهی/درخواست' })
  async getMyTasks(@CurrentUser() user: AuthUser) {
    return ok(await this.tasks.getMyTasks(user));
  }
}
