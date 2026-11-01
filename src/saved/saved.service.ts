import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import type { AuthUser } from '../common/guards';
import {
  AddSavedUserNoteDto,
  CreateSavedListDto,
  DeleteSavedListDto,
  GetSavedListUsersDto,
  MarkUserDto,
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
  /** فقط وقتی targetUserId داده شده — آیا هدف در این لیست است؟ (مودال نشان‌کردن) */
  saved?: boolean;
  /** وضعیت CRM هدف در همین لیست — فقط همراه targetUserId */
  targetStatus?: string | null;
}

export interface MarkUserResult {
  /** ردیف‌های تازه ساخته‌شده */
  added: number;
  /** ردیف‌های حذف‌شده (لیست‌های ازتیک‌خورده) */
  removed: number;
  /** آیا هدف الان در هیچ لیستی نشان است؟ */
  marked: boolean;
  /** وضعیت فعلی پس از تغییر — null یعنی نشان نیست */
  status: string | null;
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

  /** POST /saved/getSavedLists — لیست‌های کاربر + تعداد نشان‌شده‌ها؛
   *  با targetUserId: هر لیست پرچم saved و وضعیت هدف را هم می‌گیرد (مودال CRM) */
  async getSavedLists(userId: string, targetUserId?: string): Promise<SavedListDto[]> {
    const wantTarget = Boolean(targetUserId && isOid(targetUserId));
    const lists = await this.prisma.savedList.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        _count: { select: { savedUsers: true } },
        // رابطهٔ فیلترشده — فقط ردیفِ خودِ هدف (برای مودال)
        ...(wantTarget
          ? { savedUsers: { where: { targetUserId: targetUserId as string }, select: { status: true } } }
          : {}),
      },
    });
    return lists.map((l) => ({
      id: l.id,
      name: l.name,
      cnt: l._count.savedUsers,
      ...(wantTarget
        ? {
            saved: l.savedUsers.length > 0,
            targetStatus: l.savedUsers[0]?.status ?? null,
          }
        : {}),
    }));
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

  /** POST /saved/markUser — مودال CRM (خواسته مالک ۱-۱۱ دور هفتم):
   *  سینک عضویت هدف در لیست‌های کاربر. تیک‌خورده‌ها = عضو؛ ردیف‌های هدف در
   *  لیست‌های دیگر کاربر حذف می‌شوند (برداشتن تیک = حذف از آن لیست).
   *  وضعیت داده شود روی همهٔ ردیف‌های باقی‌مانده اعمال می‌شود. */
  async markUser(user: AuthUser, dto: MarkUserDto): Promise<MarkUserResult> {
    if (!isOid(dto.targetUserId)) throw AppError.notFound('کاربر یافت نشد.');
    if (dto.targetUserId === user.id) {
      throw AppError.badRequest('خودتان را نمی‌توانید نشان کنید.', 'SELF_SAVE');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: dto.targetUserId },
      select: { id: true },
    });
    if (!target) throw AppError.notFound('کاربر یافت نشد.');

    // مالکیت همهٔ لیست‌های تیک‌خورده یک‌جا چک شود — لیست غلط = 404
    const wanted = [...new Set(dto.listIds)] as string[];
    const owned = await this.prisma.savedList.findMany({
      where: { userId: user.id, id: { in: wanted } },
      select: { id: true },
    });
    if (owned.length !== wanted.length) throw AppError.notFound('لیست یافت نشد.');

    const { added, removed } = await this.prisma.$transaction(async (tx) => {
      // ردیف‌های فعلی هدف در همهٔ لیست‌های کاربر
      const rows = await tx.savedUser.findMany({
        where: { targetUserId: dto.targetUserId, savedList: { userId: user.id } },
        select: { id: true, savedListId: true },
      });
      const keepIds = new Set(owned.map((l) => l.id));
      const haveSet = new Set(rows.map((r) => r.savedListId));
      const toRemove = rows.filter((r) => !keepIds.has(r.savedListId));
      const toCreate = owned.filter((l) => !haveSet.has(l.id));

      // حذف با یادداشت‌ها (cascade دستی — رویهٔ همین ماژول)
      if (toRemove.length > 0) {
        await tx.savedUserNote.deleteMany({
          where: { savedUserId: { in: toRemove.map((r) => r.id) } },
        });
        await tx.savedUser.deleteMany({
          where: { id: { in: toRemove.map((r) => r.id) } },
        });
      }
      if (toCreate.length > 0) {
        await tx.savedUser.createMany({
          data: toCreate.map((l) => ({
            savedListId: l.id,
            targetUserId: dto.targetUserId,
            ...(dto.status ? { status: dto.status } : {}),
          })),
        });
      }
      // وضعیت روی همهٔ ردیف‌های باقی‌ماندهٔ این هدف اعمال شود
      if (dto.status) {
        await tx.savedUser.updateMany({
          where: { targetUserId: dto.targetUserId, savedList: { userId: user.id } },
          data: { status: dto.status },
        });
      }
      return { added: toCreate.length, removed: toRemove.length };
    });

    const remaining = await this.prisma.savedUser.findFirst({
      where: { targetUserId: dto.targetUserId, savedList: { userId: user.id } },
      orderBy: { updatedAt: 'desc' },
      select: { status: true },
    });
    return {
      added,
      removed,
      marked: remaining != null,
      status: remaining?.status ?? null,
    };
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
