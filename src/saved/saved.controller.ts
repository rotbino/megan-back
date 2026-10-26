import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SavedService } from './saved.service';
import {
  AddSavedUserNoteDto,
  CreateSavedListDto,
  DeleteSavedListDto,
  GetSavedListUsersDto,
  MoveSavedUserDto,
  RemoveSavedUserDto,
  SaveBuyerToListDto,
  SetSavedUserStatusDto,
  UpdateSavedListDto,
} from './dto';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';

@ApiTags('saved')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('saved')
export class SavedController {
  constructor(private readonly saved: SavedService) {}

  @Post('getSavedLists')
  @ApiOperation({ summary: 'لیست‌های نشان‌شده‌های کاربر + تعداد' })
  async getSavedLists(@CurrentUser() user: AuthUser) {
    return ok(await this.saved.getSavedLists(user.id));
  }

  @Post('createSavedList')
  @ApiOperation({ summary: '«لیست جدید» با نام یکتا' })
  async createSavedList(@CurrentUser() user: AuthUser, @Body() dto: CreateSavedListDto) {
    return ok(await this.saved.createList(user, dto), 'لیست جدید ساخته شد.');
  }

  @Post('updateSavedList')
  @ApiOperation({ summary: 'تنظیمات لیست — تغییر نام' })
  async updateSavedList(@CurrentUser() user: AuthUser, @Body() dto: UpdateSavedListDto) {
    return ok(await this.saved.updateList(user, dto), 'نام لیست تغییر کرد.');
  }

  @Post('deleteSavedList')
  @ApiOperation({ summary: 'تنظیمات لیست — حذف با همه نشان‌شده‌ها' })
  async deleteSavedList(@CurrentUser() user: AuthUser, @Body() dto: DeleteSavedListDto) {
    return ok(await this.saved.deleteList(user, dto), 'لیست حذف شد.');
  }

  @Post('getSavedListUsers')
  @ApiOperation({ summary: 'خریداران لیست + وضعیت CRM + یادداشت‌ها' })
  async getSavedListUsers(@CurrentUser() user: AuthUser, @Body() dto: GetSavedListUsersDto) {
    return ok(await this.saved.getSavedListUsers(user, dto));
  }

  @Post('saveBuyerToList')
  @ApiOperation({ summary: '«نشان کردن» خریدار در لیست موجود یا جدید' })
  async saveBuyerToList(@CurrentUser() user: AuthUser, @Body() dto: SaveBuyerToListDto) {
    return ok(await this.saved.saveBuyer(user, dto), 'کاربر نشان شد.');
  }

  @Post('setSavedUserStatus')
  @ApiOperation({ summary: 'تغییر وضعیت CRM (در حال پیگیری/اولویت زیاد/…)' })
  async setSavedUserStatus(@CurrentUser() user: AuthUser, @Body() dto: SetSavedUserStatusDto) {
    return ok(await this.saved.setStatus(user, dto), 'وضعیت کاربر به‌روزرسانی شد.');
  }

  @Post('addSavedUserNote')
  @ApiOperation({ summary: 'یادداشت زمان‌دار روی خریدار نشان‌شده' })
  async addSavedUserNote(@CurrentUser() user: AuthUser, @Body() dto: AddSavedUserNoteDto) {
    return ok(await this.saved.addNote(user, dto), 'یادداشت ثبت شد.');
  }

  @Post('moveSavedUser')
  @ApiOperation({ summary: '«افزودن به لیست دیگر»' })
  async moveSavedUser(@CurrentUser() user: AuthUser, @Body() dto: MoveSavedUserDto) {
    return ok(await this.saved.moveUser(user, dto), 'به لیست دیگر منتقل شد.');
  }

  @Post('removeSavedUser')
  @ApiOperation({ summary: 'حذف کاربر از لیست' })
  async removeSavedUser(@CurrentUser() user: AuthUser, @Body() dto: RemoveSavedUserDto) {
    return ok(await this.saved.removeUser(user, dto), 'از لیست حذف شد.');
  }
}
