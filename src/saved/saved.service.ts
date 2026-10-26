import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import type { AuthUser } from '../common/guards';
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
  isOid,
} from './dto';

export interface SavedListDto {
  id: string;
  name: string;
  cnt: number;
}

export interface SavedUserDto {
  id: string;
  /** نام خریدار نشان‌شده */
  name: string;
  status: string;
  notes: Array<{ id: string; text: string; createdAt: Date }>;
}

/**
 * ─── CRM نشان‌شده‌ها (B7) — عین پنل باسکول ──────────────────────────────────
 * لیست‌های شخصی فروشنده (مثل «سیب زمینی») + خریداران نشان‌شده با وضعیت ۷گانه
 * و یادداشت‌های زمان‌دار. حذف لیست/خریدار فقط ردیف‌ها را می‌برد — نه کاربر را.
 */
@Injectable()
export class SavedService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── لیست‌ها ───────────────────────────────────────────────────────────────

  /** POST /saved/getSavedLists — لیست‌های کاربر + تعداد نشان‌شده‌ها */
  async getSavedLists(userId: string): Promise<SavedListDto[]> {
    const lists = await this.prisma.savedList.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        savedUsers: { select: { id: true } },
      },
    });
    return lists.map((l) => ({ id: l.id, name: l.name, cnt: l.savedUsers.length }));
  }

  /** POST /saved/createSavedList — «لیست جدید» */
  async createList(user: AuthUser, dto: CreateSavedListDto): Promise<SavedListDto> {
    const name = dto.name.trim();
    const existing = await this.prisma.savedList.findFirst({ where: { userId: user.id, name } });
    if (existing) {
      throw AppError.conflict('لیستی با این نام وجود دارد.', 'LIST_EXISTS');
    }
    const list = await this.prisma.savedList.create({
      data: { userId: user.id, name },
    });
    return { id: list.id, name: list.name, cnt: 0 };
  }

  /** POST /saved/updateSavedList — تغییر نام (تنظیمات لیست) */
  async updateList(user: AuthUser, dto: UpdateSavedListDto): Promise<SavedListDto> {
    const list = await this.ownedList(user.id, dto.listId);
    const name = dto.name.trim();
    const clash = await this.prisma.savedList.findFirst({
      where: { userId: user.id, name, id: { not: list.id } },
    });
    if (clash) throw AppError.conflict('لیستی با این نام وجود دارد.', 'LIST_EXISTS');
    const updated = await this.prisma.savedList.update({
      where: { id: list.id },
      data: { name },
    });
    const cnt = await this.prisma.savedUser.count({ where: { savedListId: list.id } });
    return { id: updated.id, name: updated.name, cnt };
  }

  /** POST /saved/deleteSavedList — حذف لیست با همه نشان‌شده‌ها (cascade) */
  async deleteList(user: AuthUser, dto: DeleteSavedListDto) {
    const list = await this.ownedList(user.id, dto.listId);
    await this.prisma.savedList.delete({ where: { id: list.id } });
    return { ok: true as const };
  }

  // ─── کارت‌های CRM ──────────────────────────────────────────────────────────

  /** POST /saved/getSavedListUsers — خریداران لیست + وضعیت + یادداشت‌ها */
  async getSavedListUsers(user: AuthUser, dto: GetSavedListUsersDto): Promise<SavedUserDto[] | null> {
    const list = await this.prisma.savedList.findFirst({
      where: { id: isOid(dto.listId) ? dto.listId : '!', userId: user.id },
    });
    if (!list) return null;

    const rows = await this.prisma.savedUser.findMany({
      where: { savedListId: list.id },
      orderBy: { createdAt: 'desc' },
      include: {
        notes: { orderBy: { createdAt: 'desc' } },
        targetUser: { select: { firstName: true, lastName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: `${r.targetUser.firstName} ${r.targetUser.lastName}`.trim() || 'کاربر ایمچ',
      status: r.status,
      notes: r.notes.map((n) => ({ id: n.id, text: n.text, createdAt: n.createdAt })),
    }));
  }

  /** POST /saved/saveBuyerToList — «نشان کردن» خریدار (از کارت درخواست خرید) */
  async saveBuyer(user: AuthUser, dto: SaveBuyerToListDto) {
    if (!isOid(dto.targetUserId)) throw AppError.notFound('کاربر یافت نشد.');
    const target = await this.prisma.user.findUnique({
      where: { id: dto.targetUserId },
      select: { id: true },
    });
    if (!target) throw AppError.notFound('کاربر یافت نشد.');
    if (target.id === user.id) {
      throw AppError.badRequest('خودتان را نمی‌توانید نشان کنید.', 'SELF_SAVE');
    }

    // مقصد: لیست موجود یا لیست جدید با نام — عین مودال باسکول
    let listId: string | null = null;
    if (dto.listId) {
      const list = await this.ownedList(user.id, dto.listId);
      listId = list.id;
    } else if (dto.listName?.trim()) {
      const name = dto.listName.trim();
      let list = await this.prisma.savedList.findFirst({ where: { userId: user.id, name } });
      if (!list) list = await this.prisma.savedList.create({ data: { userId: user.id, name } });
      listId = list.id;
    } else {
      // بدون انتخاب: اولین لیست یا لیست پیش‌فرض «نشان شده‌ها»
      let list = await this.prisma.savedList.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });
      if (!list) list = await this.prisma.savedList.create({ data: { userId: user.id, name: 'نشان شده ها' } });
      listId = list.id;
    }

    const existing = await this.prisma.savedUser.findUnique({
      where: { savedListId_targetUserId: { savedListId: listId, targetUserId: dto.targetUserId } },
    });
    if (existing) {
      throw AppError.conflict('این کاربر قبلا در لیست نشان شده است.', 'ALREADY_SAVED');
    }
    const row = await this.prisma.savedUser.create({
      data: { savedListId: listId, targetUserId: dto.targetUserId },
    });
    return { savedUserId: row.id, listId };
  }

  /** POST /saved/setSavedUserStatus — دراپ‌داون وضعیت کاربر */
  async setStatus(user: AuthUser, dto: SetSavedUserStatusDto) {
    const row = await this.ownedSavedUser(user.id, dto.savedUserId);
    await this.prisma.savedUser.update({
      where: { id: row.id },
      data: { status: dto.status },
    });
    return { ok: true as const };
  }

  /** POST /saved/addSavedUserNote — «یادم باشه زنگ بزنم» */
  async addNote(user: AuthUser, dto: AddSavedUserNoteDto) {
    const row = await this.ownedSavedUser(user.id, dto.savedUserId);
    const note = await this.prisma.savedUserNote.create({
      data: { savedUserId: row.id, text: dto.text.trim() },
    });
    return { id: note.id, text: note.text, createdAt: note.createdAt };
  }

  /** POST /saved/moveSavedUser — «افزودن به لیست دیگر» */
  async moveUser(user: AuthUser, dto: MoveSavedUserDto) {
    const row = await this.ownedSavedUser(user.id, dto.savedUserId);
    const dest = await this.ownedList(user.id, dto.toListId);
    if (dest.id === row.savedListId) {
      throw AppError.badRequest('این کاربر همین حالا در این لیست است.', 'SAME_LIST');
    }
    const clash = await this.prisma.savedUser.findUnique({
      where: { savedListId_targetUserId: { savedListId: dest.id, targetUserId: row.targetUserId } },
    });
    if (clash) {
      throw AppError.conflict('این کاربر قبلا در لیست مقصد نشان شده است.', 'ALREADY_SAVED');
    }
    await this.prisma.savedUser.update({
      where: { id: row.id },
      data: { savedListId: dest.id },
    });
    return { ok: true as const };
  }

  /** POST /saved/removeSavedUser — حذف از لیست */
  async removeUser(user: AuthUser, dto: RemoveSavedUserDto) {
    const row = await this.ownedSavedUser(user.id, dto.savedUserId);
    await this.prisma.savedUser.delete({ where: { id: row.id } });
    return { ok: true as const };
  }

  // ─── داخلی ─────────────────────────────────────────────────────────────────

  /** لیست متعلق به کاربر — وگرنه 404 تمیز */
  private async ownedList(userId: string, listId: string) {
    if (!isOid(listId)) throw AppError.notFound('لیست یافت نشد.');
    const list = await this.prisma.savedList.findFirst({ where: { id: listId, userId } });
    if (!list) throw AppError.notFound('لیست یافت نشد.');
    return list;
  }

  /** نشان‌شده از مسیر لیستِ خود کاربر — وگرنه 404 تمیز */
  private async ownedSavedUser(userId: string, savedUserId: string) {
    if (!isOid(savedUserId)) throw AppError.notFound('کاربر نشان‌شده یافت نشد.');
    const row = await this.prisma.savedUser.findFirst({
      where: { id: savedUserId, savedList: { userId } },
    });
    if (!row) throw AppError.notFound('کاربر نشان‌شده یافت نشد.');
    return row;
  }
}
