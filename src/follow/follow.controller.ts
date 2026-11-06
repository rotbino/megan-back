import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FollowService } from './follow.service';
import {
  AddItemNoteDto,
  CreateFolderDto,
  DeleteFolderDto,
  GetAllItemsDto,
  GetFolderItemsDto,
  GetFollowingMapDto,
  GetFoldersDto,
  IsFollowingDto,
  MoveItemDto,
  RemoveItemDto,
  RenameFolderDto,
  SetItemPriorityDto,
  SetItemStatusDto,
  SetNextFollowDto,
  UpsertItemDto,
} from './dto';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';

/**
 * پیگیری‌ها — CRM کوچک ایمچ (جایگزین نشان‌شده‌های باسکول، خواسته مالک ۶-۱۱).
 * جریان ذخیره دومرحله‌ای: ۱) انتخاب/ساخت پرونده ۲) وضعیت قیف + یادداشت اختیاری.
 * قیف: در بررسی ← تماس گرفتم ← در مذاکره ← نهایی شد / منصرف شدم.
 */
@ApiTags('follow')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
/** حد نرخ ریزتر از سراسری — CRM پیگیری — نوشتن مکرر */
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('follow')
export class FollowController {
  constructor(private readonly follow: FollowService) {}

  @Post('getFolders')
  @ApiOperation({ summary: 'پرونده‌های پیگیری کاربر + تعداد + خلاصه قیف وضعیت‌ها' })
  async getFolders(@CurrentUser() user: AuthUser, @Body() _dto: GetFoldersDto) {
    return ok(await this.follow.getFolders(user.id));
  }

  @Post('createFolder')
  @ApiOperation({ summary: '«پرونده جدید» با نام یکتا' })
  async createFolder(@CurrentUser() user: AuthUser, @Body() dto: CreateFolderDto) {
    return ok(await this.follow.createFolder(user, dto), 'پرونده جدید ساخته شد.');
  }

  @Post('renameFolder')
  @ApiOperation({ summary: 'تغییر نام پرونده' })
  async renameFolder(@CurrentUser() user: AuthUser, @Body() dto: RenameFolderDto) {
    await this.follow.renameFolder(user, dto);
    return ok(true, 'نام پرونده تغییر کرد.');
  }

  @Post('deleteFolder')
  @ApiOperation({ summary: 'حذف پرونده با همه موارد و یادداشت‌ها' })
  async deleteFolder(@CurrentUser() user: AuthUser, @Body() dto: DeleteFolderDto) {
    await this.follow.deleteFolder(user, dto);
    return ok(true, 'پرونده حذف شد.');
  }

  @Post('getFolderItems')
  @ApiOperation({ summary: 'موارد یک پرونده — با snapshot درخواست خرید/آگهی، وضعیت و یادداشت‌ها' })
  async getFolderItems(@CurrentUser() user: AuthUser, @Body() dto: GetFolderItemsDto) {
    return ok(await this.follow.getFolderItems(user, dto));
  }

  @Post('getAllItems')
  @ApiOperation({ summary: 'همهٔ موارد کاربر از همهٔ پرونده‌ها — تک‌صفحهٔ CRM (جستجو/فیلتر سمت فرانت)' })
  async getAllItems(@CurrentUser() user: AuthUser, @Body() _dto: GetAllItemsDto) {
    return ok(await this.follow.getAllItems(user));
  }

  @Post('upsertItem')
  @ApiOperation({
    summary: 'ذخیره/به‌روزرسانی مورد (گام ۲): پرونده + وضعیت + یادداشت اختیاری — انتقال خودکار اگر از قبل ذخیره باشد',
  })
  async upsertItem(@CurrentUser() user: AuthUser, @Body() dto: UpsertItemDto) {
    return ok(await this.follow.upsertItem(user, dto), 'در پیگیری‌ها ذخیره شد.');
  }

  @Post('setItemStatus')
  @ApiOperation({ summary: 'تغییر وضعیت قیف (در بررسی/تماس گرفتم/در مذاکره/نهایی شد/منصرف شدم)' })
  async setItemStatus(@CurrentUser() user: AuthUser, @Body() dto: SetItemStatusDto) {
    await this.follow.setItemStatus(user, dto);
    return ok(true, 'وضعیت به‌روزرسانی شد.');
  }

  @Post('setItemPriority')
  @ApiOperation({ summary: 'تغییر اولویت (بالا/متوسط/کم) — اولویت‌های بالا در لیست بالاتر (خواسته مالک ۷-۱۱)' })
  async setItemPriority(@CurrentUser() user: AuthUser, @Body() dto: SetItemPriorityDto) {
    await this.follow.setItemPriority(user, dto);
    return ok(true, 'اولویت به‌روزرسانی شد.');
  }

  @Post('setNextFollow')
  @ApiOperation({ summary: 'یادآور «پیگیری بعدی N روز دیگر» — days=0 حذف یادآور (خواسته مالک ۷-۱۱)' })
  async setNextFollow(@CurrentUser() user: AuthUser, @Body() dto: SetNextFollowDto) {
    await this.follow.setNextFollow(user, dto);
    return ok(true, 'تاریخ پیگیری بعدی ثبت شد.');
  }

  @Post('moveItem')
  @ApiOperation({ summary: 'انتقال مورد به پرونده دیگر — وضعیت و یادداشت‌ها حفظ می‌شوند' })
  async moveItem(@CurrentUser() user: AuthUser, @Body() dto: MoveItemDto) {
    await this.follow.moveItem(user, dto);
    return ok(true, 'مورد به پرونده جدید منتقل شد.');
  }

  @Post('addItemNote')
  @ApiOperation({ summary: 'یادداشت زمان‌دار جدید روی مورد' })
  async addItemNote(@CurrentUser() user: AuthUser, @Body() dto: AddItemNoteDto) {
    await this.follow.addItemNote(user, dto);
    return ok(true, 'یادداشت ثبت شد.');
  }

  @Post('removeItem')
  @ApiOperation({ summary: 'حذف مورد از پیگیری' })
  async removeItem(@CurrentUser() user: AuthUser, @Body() dto: RemoveItemDto) {
    await this.follow.removeItem(user, dto);
    return ok(true, 'از پیگیری‌ها حذف شد.');
  }

  @Post('isFollowing')
  @ApiOperation({ summary: 'وضعیت دکمهٔ ذخیره — آیا این هدف در پیگیری من است؟' })
  async isFollowing(@CurrentUser() user: AuthUser, @Body() dto: IsFollowingDto) {
    return ok(await this.follow.isFollowing(user, dto.targetType, dto.targetId));
  }

  @Post('getFollowingMap')
  @ApiOperation({
    summary: 'نقشهٔ موارد ذخیره‌شدهٔ یک نوع — یک درخواست مشترک برای همهٔ دکمه‌های ذخیرهٔ صفحه به‌جای N درخواست',
  })
  async getFollowingMap(@CurrentUser() user: AuthUser, @Body() dto: GetFollowingMapDto) {
    return ok(await this.follow.getFollowingMap(user, dto.targetType));
  }
}
