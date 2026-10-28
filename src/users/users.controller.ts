import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ok } from '../common/api-response';

@ApiTags('users')
/** حد نرخ ریزتر از سراسری — پروفایل — کم‌ترافیک */
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getProfile')
  @ApiOperation({ summary: 'پروفایل کامل کاربر جاری' })
  async getProfile(@CurrentUser() user: { id: string }) {
    return ok(await this.users.getProfile(user.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('updateProfile')
  @ApiOperation({ summary: 'ویرایش پروفایل (نام، جنسیت، نقش خریدار/فروشنده، کسب‌وکار)' })
  async updateProfile(@CurrentUser() user: { id: string }, @Body() dto: UpdateProfileDto) {
    return ok(await this.users.updateProfile(user.id, dto), 'پروفایل به‌روزرسانی شد.');
  }
}
