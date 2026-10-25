import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { GetUserByPhoneDto, UpdateProfileDto } from './dto';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ok } from '../common/api-response';

@ApiTags('users')
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

  @Post('getUserByPhone')
  @ApiOperation({ summary: 'اطلاعات عمومی حداقلی یک کاربر با شماره موبایل' })
  async getUserByPhone(@Body() dto: GetUserByPhoneDto) {
    return ok(await this.users.getUserByPhone(dto.phone));
  }
}
