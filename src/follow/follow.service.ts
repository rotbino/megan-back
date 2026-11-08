import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import { CategoriesService } from '../categories/categories.service';
import { LocationsService } from '../locations/locations.service';
import { UploadsService } from '../uploads/uploads.service';
import type { AuthUser } from '../common/guards';
import type {
  AddItemNoteDto,
  CreateFolderDto,
  DeleteFolderDto,
  FollowFolderKind,
  FollowStatus,
  FollowTargetType,
  GetFolderItemsDto,
  MoveItemDto,
  RemoveItemDto,
  RenameFolderDto,
  SetItemPriorityDto,
  SetItemStatusDto,
  SetNextFollowDto,
  UpsertItemDto,
} from './dto';

/**
 * ─── پیگیری‌ها — CRM کوچک ایمچ (خواسته مالک ۶-۱۱) ────────────────────────────
 *
 * جایگزین «نشان‌شده‌های باسکول»: به‌جای مودال چندلیستی با وضعیت‌های ۷گانهٔ
 * درهم، جریان ساده و مستقیم برای خریدار و فروشندهٔ عمده:
 *
 *   ذخیره (دو گام: پرونده ← وضعیت+یادداشت اختیاری)
 *   → پرونده‌های موضوعی («خرید سیب زمینی»)
 *   → قیف تماس: در بررسی ← تماس گرفتم ← در مذاکره ← نهایی شد / منصرف شدم
 *   → یادداشت‌های زمان‌دار روی هر مورد
 *
 * هدف چندریخت است: درخواست خرید (دید فروشنده) یا آگهی فروش (دید خریدار).
 * هر هدف حداکثر یک‌بار در پیگیری هر کاربر می‌نشیند؛ انتقال بین پرونده‌ها
 * جابه‌جایی است نه تکرار. موارد یتیم (هدف حذف‌شده) هنگام خواندن فیلتر می‌شوند.
 */

/** قالب تاریخ باسکول: «YYYY-MM-DD HH:mm:ss» */
const fmtDate = (d: Date | null | undefined): string =>
  d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : '';

export interface FollowFolderDto {
  id: string;
  name: string;
  itemCount: number;
  /** خلاصه قیف — { reviewing: 2, contacted: 1 } */
  statusCounts: Partial<Record<FollowStatus, number>>;
  updatedAt: string;
}

export interface FollowItemDto {
  id: string;
  folderId: string;
  folderName: string;
  targetType: FollowTargetType;
  targetId: number;
  status: FollowStatus;
  /** اولویت — 1 بالا / 2 متوسط / 3 کم (خواسته مالک ۷-۱۱) */
  priority: number;
  /** تاریخ پیگیری بعدی (YYYY-MM-DD HH:mm:ss) یا null — از «N روز دیگر» */
  nextFollowAt: string | null;
  notes: Array<{ id: string; text: string; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
  /** snapshot کامل هدف برای نمایش — BuyRequestDto یا ProductDto */
  target: Record<string, unknown>;
}

@Injectable()
export class FollowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly locations: LocationsService,
    private readonly uploads: UploadsService,
  ) {}

  // ─── پرونده‌ها ─────────────────────────────────────────────────────────────

  /** نوع پروندهٔ متناظر هر نوع هدف — آگهی (product) → سرنخ خرید،
   *  درخواست خرید (buy_request) → سرنخ فروش (خواستهٔ مالک ۸-۱۱ دور ۲۸) */
  private static kindOfTarget(targetType: FollowTargetType): FollowFolderKind {
    return targetType === 'buy_request' ? 'sell' : 'buy';
  }

  /** برچسب فارسی نوع سرنخ — برای پیام خطای پروندهٔ ناهمخوان */
  private static kindLabel(kind: FollowFolderKind): string {
    return kind === 'sell' ? 'فروش' : 'خرید';
  }

  /** POST /follow/getFolders — پرونده‌های کاربر با تعداد و خلاصه قیف؛
   *  kind اختیاری: فقط همان نوع سرنخ — پرونده‌های خرید و فروش مستقل‌اند.
   *  سورت بر اساس آخرین تحول (آخرین تغییر روی موارد یا خود پرونده) */
  async getFolders(userId: string, kind?: FollowFolderKind): Promise<FollowFolderDto[]> {
    const [folders, items] = await Promise.all([
      this.prisma.followFolder.findMany({ where: { userId, ...(kind ? { kind } : {}) } }),
      this.prisma.followItem.findMany({
        where: { userId },
        select: { folderId: true, status: true, updatedAt: true },
      }),
    ]);

    return folders
      .map((f) => {
        const mine = items.filter((i) => i.folderId === f.id);
        const statusCounts: Partial<Record<FollowStatus, number>> = {};
        mine.forEach((i) => {
          statusCounts[i.status as FollowStatus] = (statusCounts[i.status as FollowStatus] ?? 0) + 1;
        });
        const latest = mine.reduce((acc, i) => (i.updatedAt > acc ? i.updatedAt : acc), f.updatedAt);
        return {
          id: f.id,
          name: f.name,
          itemCount: mine.length,
          statusCounts,
          updatedAt: fmtDate(latest),
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** POST /follow/createFolder — نام یکتا به‌ازای کاربر در همان نوع سرنخ */
  async createFolder(user: AuthUser, dto: CreateFolderDto): Promise<FollowFolderDto> {
    const name = dto.name.trim();
    if (!name) throw AppError.badRequest('نام پرونده نمی‌تواند خالی باشد.');
    const kind = dto.kind ?? 'buy';
    const dupe = await this.prisma.followFolder.findFirst({ where: { userId: user.id, name, kind } });
    if (dupe) throw AppError.badRequest('پرونده‌ای با همین نام دارید.');
    const folder = await this.prisma.followFolder.create({ data: { userId: user.id, name, kind } });
    return {
      id: folder.id,
      name: folder.name,
      itemCount: 0,
      statusCounts: {},
      updatedAt: fmtDate(folder.updatedAt),
    };
  }

  /** POST /follow/renameFolder */
  async renameFolder(user: AuthUser, dto: RenameFolderDto): Promise<void> {
    const name = dto.name.trim();
    if (!name) throw AppError.badRequest('نام پرونده نمی‌تواند خالی باشد.');
    const folder = await this.ownFolder(user.id, dto.folderId);
    if (folder.name !== name) {
      const dupe = await this.prisma.followFolder.findFirst({
        where: { userId: user.id, name, kind: folder.kind },
      });
      if (dupe) throw AppError.badRequest('پرونده‌ای با همین نام دارید.');
      await this.prisma.followFolder.update({ where: { id: folder.id }, data: { name } });
    }
  }

  /** POST /follow/deleteFolder — موارد و یادداشت‌ها با cascade حذف می‌شوند */
  async deleteFolder(user: AuthUser, dto: DeleteFolderDto): Promise<void> {
    const folder = await this.ownFolder(user.id, dto.folderId);
    await this.prisma.followFolder.delete({ where: { id: folder.id } });
  }

  // ─── موارد پیگیری ──────────────────────────────────────────────────────────

  /** POST /follow/getFolderItems — موارد پرونده با snapshot هدف؛ یتیم‌ها فیلتر می‌شوند */
  async getFolderItems(user: AuthUser, dto: GetFolderItemsDto): Promise<FollowItemDto[]> {
    const folder = await this.ownFolder(user.id, dto.folderId);
    const items = await this.prisma.followItem.findMany({
      where: { folderId: folder.id },
      include: { notes: true },
      orderBy: { updatedAt: 'desc' },
    });
    return this.decorate(items, folder.name);
  }

  /** POST /follow/upsertItem — گام ۲ جریان ذخیره.
   *  هدف تازه: ایجاد در پرونده با وضعیت (+ اولویت + یادآور + یادداشت اختیاری).
   *  هدف از قبل ذخیره‌شده: انتقال به پروندهٔ انتخابی + به‌روزرسانی وضعیت/اولویت/یادآور.
   *  دور ۲۸: پروندهٔ ناهمخوان با نوع سرنخ رد می‌شود؛ پروندهٔ قدیمیِ بی‌نوع
   *  (قبل از دور ۲۸) با اولین ذخیره به نوع درست برچسب می‌خورد. */
  async upsertItem(user: AuthUser, dto: UpsertItemDto): Promise<FollowItemDto> {
    const folder = await this.assertFolderKind(user.id, dto.folderId, dto.targetType);
    await this.assertTargetExists(dto.targetType, dto.targetId);

    const note = dto.note?.trim();
    // «پیگیری بعدی N روز دیگر» — 0/غیب = بی‌تغییر روی آپدیت، null روی ایجاد
    const nextFollowAt =
      dto.nextFollowDays == null ? undefined : this.computeNextFollowAt(dto.nextFollowDays);

    const data = {
      folderId: folder.id,
      userId: user.id,
      targetType: dto.targetType,
      targetId: dto.targetId,
      status: dto.status ?? 'reviewing',
      priority: dto.priority ?? 2,
    };

    const item = await this.prisma.followItem.upsert({
      where: {
        userId_targetType_targetId: {
          userId: user.id,
          targetType: dto.targetType,
          targetId: dto.targetId,
        },
      },
      create: {
        ...data,
        ...(nextFollowAt !== undefined && { nextFollowAt }),
        ...(note ? { notes: { create: { text: note } } } : {}),
      },
      update: {
        folderId: data.folderId,
        status: data.status,
        priority: data.priority,
        ...(nextFollowAt !== undefined && { nextFollowAt }),
        ...(note ? { notes: { create: { text: note } } } : {}),
      },
      include: { notes: true },
    });

    const [decorated] = await this.decorate([item], folder.name);
    return decorated;
  }

  /** POST /follow/setItemStatus — تغییر وضعیت قیف */
  async setItemStatus(user: AuthUser, dto: SetItemStatusDto): Promise<void> {
    await this.ownItem(user.id, dto.itemId);
    await this.prisma.followItem.update({
      where: { id: dto.itemId },
      data: { status: dto.status },
    });
  }

  /** POST /follow/setItemPriority — تغییر اولویت (خواسته مالک ۷-۱۱:
   *  «تغییر اولویت» زیر سه‌نقطه و در مودال؛ اولویت‌های بالا در لیست بالاتر) */
  async setItemPriority(user: AuthUser, dto: SetItemPriorityDto): Promise<void> {
    await this.ownItem(user.id, dto.itemId);
    await this.prisma.followItem.update({
      where: { id: dto.itemId },
      data: { priority: dto.priority },
    });
  }

  /** POST /follow/setNextFollow — یادآور «پیگیری بعدی N روز دیگر»؛
   *  days=0 یادآور را برمی‌دارد؛ فیلتر «پیگیری‌های امروز» سررسیده‌ها را نشان می‌دهد */
  async setNextFollow(user: AuthUser, dto: SetNextFollowDto): Promise<void> {
    await this.ownItem(user.id, dto.itemId);
    await this.prisma.followItem.update({
      where: { id: dto.itemId },
      data: { nextFollowAt: this.computeNextFollowAt(dto.days) },
    });
  }

  /** POST /follow/moveItem — انتقال به پروندهٔ دیگر (از همان نوع سرنخ — دور ۲۸) */
  async moveItem(user: AuthUser, dto: MoveItemDto): Promise<void> {
    const item = await this.ownItem(user.id, dto.itemId);
    const dest = await this.assertFolderKind(user.id, dto.folderId, item.targetType as FollowTargetType);
    if (item.folderId !== dest.id) {
      await this.prisma.followItem.update({
        where: { id: item.id },
        data: { folderId: dest.id },
      });
    }
  }

  /** POST /follow/addItemNote — یادداشت زمان‌دار جدید */
  async addItemNote(user: AuthUser, dto: AddItemNoteDto): Promise<void> {
    await this.ownItem(user.id, dto.itemId);
    await this.prisma.$transaction([
      this.prisma.followNote.create({
        data: { followItemId: dto.itemId, text: dto.text.trim() },
      }),
      this.prisma.followItem.update({
        where: { id: dto.itemId },
        data: { updatedAt: new Date() },
      }),
    ]);
  }

  /** POST /follow/removeItem — حذف مورد (یادداشت‌ها هم cascade) */
  async removeItem(user: AuthUser, dto: RemoveItemDto): Promise<void> {
    const item = await this.ownItem(user.id, dto.itemId);
    await this.prisma.followItem.delete({ where: { id: item.id } });
  }

  /** POST /follow/isFollowing — وضعیت دکمهٔ ذخیره روی کارت‌ها */
  async isFollowing(
    user: AuthUser,
    targetType: FollowTargetType,
    targetId: number,
  ): Promise<{ following: boolean; item: FollowItemDto | null }> {
    const item = await this.prisma.followItem.findFirst({
      where: { userId: user.id, targetType, targetId },
      include: { notes: true, folder: true },
    });
    if (!item) return { following: false, item: null };
    const [decorated] = await this.decorate([item], item.folder.name);
    return { following: true, item: decorated };
  }

  /** POST /follow/getFollowingMap — همهٔ موارد یک نوع برای نقشهٔ دکمه‌های ذخیره؛
   *  یک درخواست به‌جای N درخواست isFollowing در صفحات فهرست (۱۶ کارت = ۱ درخواست).
   *  خروجی همان آرایهٔ FollowItemDto است؛ فرانت به Record<targetId, item> تبدیل می‌کند. */
  async getFollowingMap(user: AuthUser, targetType: FollowTargetType): Promise<FollowItemDto[]> {
    const items = await this.prisma.followItem.findMany({
      where: { userId: user.id, targetType },
      include: { notes: true, folder: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return this.decorateGrouped(items);
  }

  /** POST /follow/getAllItems — همهٔ موارد کاربر از همهٔ پرونده‌ها (تک‌صفحهٔ CRM:
   *  جستجو + فیلتر پرونده/وضعیت/شهر سمت فرانت روی همین لیست انجام می‌شود).
   *  targetType اختیاری — صفحات سرنخ خرید و سرنخ فروش مستقل‌اند (دور ۲۸). */
  async getAllItems(user: AuthUser, targetType?: FollowTargetType): Promise<FollowItemDto[]> {
    const items = await this.prisma.followItem.findMany({
      where: { userId: user.id, ...(targetType ? { targetType } : {}) },
      include: { notes: true, folder: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return this.decorateGrouped(items);
  }

  // ─── داخلی ────────────────────────────────────────────────────────────────

  /** پروندهٔ متعلق به کاربر یا ۴۰۴ */
  private async ownFolder(userId: string, folderId: string) {
    const folder = await this.prisma.followFolder.findFirst({ where: { id: folderId, userId } });
    if (!folder) throw AppError.notFound('پرونده پیدا نشد.');
    return folder;
  }

  /** پروندهٔ متعلق به کاربر با نوع درست سرنخ — مستقل‌سازی خرید/فروش (دور ۲۸):
   *  پروندهٔ قدیمیِ بی‌نوع با اولین استفاده برچسب می‌خورد؛ پروندهٔ ناهمخوان
   *  پیام روشن می‌دهد تا سرنخ خرید و فروش هرگز در هم مخلوط نشوند. */
  private async assertFolderKind(userId: string, folderId: string, targetType: FollowTargetType) {
    const folder = await this.ownFolder(userId, folderId);
    const expected = FollowService.kindOfTarget(targetType);
    if (folder.kind && folder.kind !== expected) {
      throw AppError.badRequest(
        `این پرونده مخصوص سرنخ‌های ${FollowService.kindLabel(folder.kind as FollowFolderKind)} است — برای این ذخیره پرونده‌ای از سرنخ‌های ${FollowService.kindLabel(expected)} انتخاب کنید.`,
      );
    }
    if (!folder.kind) {
      await this.prisma.followFolder.update({
        where: { id: folder.id },
        data: { kind: expected },
      }).catch(() => undefined); // برچسب‌خوردن بهترین‌حال است
    }
    return folder;
  }

  /** «پیگیری بعدی N روز دیگر» → تاریخ مطلق از نیمه‌شبِ امروز؛ 0 = حذف یادآور (null).
   *  نیمه‌شب مبناست تا نمایش «N روز دیگر» دقیقاً همان N ورودی کاربر بماند. */
  private computeNextFollowAt(days: number): Date | null {
    if (days <= 0) return null;
    const at = new Date();
    at.setHours(0, 0, 0, 0);
    at.setDate(at.getDate() + days);
    return at;
  }

  /** مورد متعلق به کاربر یا ۴۰۴ */
  private async ownItem(userId: string, itemId: string) {
    const item = await this.prisma.followItem.findFirst({ where: { id: itemId, userId } });
    if (!item) throw AppError.notFound('مورد پیگیری پیدا نشد.');
    return item;
  }

  /** بررسی وجود هدف قبل از ذخیره — پیام واضح به‌جای مورد یتیم */
  private async assertTargetExists(targetType: FollowTargetType, targetId: number): Promise<void> {
    const exists =
      targetType === 'buy_request'
        ? await this.prisma.buyRequest.findUnique({ where: { id: targetId } })
        : await this.prisma.product.findUnique({ where: { id: targetId } });
    if (!exists) {
      throw AppError.notFound(
        targetType === 'buy_request' ? 'درخواست خرید پیدا نشد.' : 'آگهی پیدا نشد.',
      );
    }
  }

  /** تبدیل ردیف‌ها به شکل سیمی فرانت + snapshot هدف (یتیم‌ها فیلتر) */
  private async decorate(
    items: Prisma.FollowItemGetPayload<{ include: { notes: true } }>[],
    folderName: string,
  ): Promise<FollowItemDto[]> {
    if (items.length === 0) return [];

    const reqIds = items.filter((i) => i.targetType === 'buy_request').map((i) => i.targetId);
    const prodIds = items.filter((i) => i.targetType === 'product').map((i) => i.targetId);

    const [requests, products] = await Promise.all([
      reqIds.length
        ? this.prisma.buyRequest.findMany({ where: { id: { in: reqIds } } })
        : Promise.resolve([]),
      prodIds.length
        ? this.prisma.product.findMany({ where: { id: { in: prodIds } } })
        : Promise.resolve([]),
    ]);

    const reqTargets = await this.serializeBuyRequests(requests);
    const prodTargets = await this.serializeProducts(products);
    const reqById = new Map(reqTargets.map((t) => [t.id as number, t]));
    const prodById = new Map(prodTargets.map((t) => [t.id as number, t]));

    const out: FollowItemDto[] = [];
    for (const item of items) {
      const target =
        item.targetType === 'buy_request' ? reqById.get(item.targetId) : prodById.get(item.targetId);
      if (!target) continue; // یتیم — هدف حذف شده
      out.push({
        id: item.id,
        folderId: item.folderId,
        folderName,
        targetType: item.targetType as FollowTargetType,
        targetId: item.targetId,
        status: item.status as FollowStatus,
        priority: item.priority ?? 2,
        nextFollowAt: item.nextFollowAt ? fmtDate(item.nextFollowAt) : null,
        notes: item.notes.map((n) => ({
          id: n.id,
          text: n.text,
          createdAt: fmtDate(n.createdAt),
        })),
        createdAt: fmtDate(item.createdAt),
        updatedAt: fmtDate(item.updatedAt),
        target,
      });
    }
    return out;
  }

  /** گروه‌بندی ردیف‌ها بر اساس پرونده + تزئین با نام پرونده —
   *  مشترک بین نقشهٔ دکمه‌ها (getFollowingMap) و تک‌صفحهٔ CRM (getAllItems) */
  private async decorateGrouped(
    items: Prisma.FollowItemGetPayload<{
      include: { notes: true; folder: { select: { name: true } } };
    }>[],
  ): Promise<FollowItemDto[]> {
    if (items.length === 0) return [];
    const byFolder = new Map<string, typeof items>();
    for (const item of items) {
      const group = byFolder.get(item.folderId);
      if (group) group.push(item);
      else byFolder.set(item.folderId, [item]);
    }
    const groups = await Promise.all(
      [...byFolder.values()].map((group) => this.decorate(group, group[0].folder.name)),
    );
    return groups.flat();
  }

  /** snapshot درخواست خرید — هم‌شکل RawBuyRequest فرانت (الگوی BuyRequestsService.toDto) */
  private async serializeBuyRequests(
    rows: Array<{
      id: number;
      name: string | null;
      categoryId: number;
      requirementAmount: number;
      unit: string;
      userId: string;
      cityId: number | null;
      createdAt: Date;
    }>,
  ): Promise<Array<Record<string, unknown>>> {
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const catIds = [...new Set(rows.map((r) => r.categoryId))];
    const cityIds = [...new Set(rows.filter((r) => r.cityId != null).map((r) => r.cityId as number))];

    const [userRows, catMap, locNames] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, userName: true, firstName: true, lastName: true, isVerified: true },
      }),
      this.categories.getNameMap(), // کش‌شده
      this.locations.getNames([], cityIds),
    ]);
    const users = new Map(userRows.map((u) => [u.id, u]));

    return rows.map((r) => {
      const buyer = users.get(r.userId);
      return {
        id: r.id,
        name: r.name,
        categoryId: r.categoryId,
        subcategoryName: catMap.get(r.categoryId)?.category_name ?? '—',
        requirementAmount: r.requirementAmount,
        unit: r.unit,
        myuserId: r.userId,
        /** شناسهٔ عمومی خریدار — چت مستقیم از CRM (ChatDialog مسیر پروفایل) */
        userName: buyer?.userName ?? null,
        firstName: buyer?.firstName ?? '—',
        lastName: buyer?.lastName ?? '—',
        city: (r.cityId != null ? locNames.cities.get(r.cityId) : undefined) ?? '—',
        isVerified: buyer?.isVerified ?? false,
        createdAt: fmtDate(r.createdAt),
      };
    });
  }

  /** snapshot آگهی فروش — هم‌شکل RawProduct فرانت (الگوی ProductsService.toDto) */
  private async serializeProducts(
    rows: Array<{
      id: number;
      productName: string;
      slug: string;
      description: string;
      categoryId: number;
      subCategoryId: number;
      provinceId: number;
      cityId: number;
      unit: string;
      stock: number;
      minSaleAmount: number;
      minSalePrice: number;
      isLadder: boolean;
      isElevated: boolean;
      hasVideo: boolean;
      isOld: boolean;
      viewCount: number;
      userId: string;
      createdAt: Date;
      updatedAt: Date;
    }>,
  ): Promise<Array<Record<string, unknown>>> {
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const catIds = [...new Set(rows.flatMap((r) => [r.categoryId, r.subCategoryId]))];
    const provinceIds = [...new Set(rows.map((r) => r.provinceId))];
    const cityIds = [...new Set(rows.map((r) => r.cityId))];

    const [userRows, catMap, locNames, gallery] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, userName: true, firstName: true, lastName: true, isVerified: true },
      }),
      this.categories.getNameMap(), // کش‌شده
      this.locations.getNames(provinceIds, cityIds),
      this.uploads.galleryMap(rows.map((r) => r.id)),
    ]);
    const users = new Map(userRows.map((u) => [u.id, u]));
    const UNKNOWN = '—';

    return rows.map((p) => {
      const files = gallery.get(p.id) ?? [];
      const photos = files.map((f) => f.url);
      const seller = users.get(p.userId);
      return {
        id: p.id,
        productName: p.productName,
        slug: p.slug,
        description: p.description,
        stock: p.stock,
        minSalePrice: p.minSalePrice,
        minSaleAmount: p.minSaleAmount,
        unit: p.unit,
        categoryId: p.categoryId,
        categoryName: catMap.get(p.categoryId)?.category_name ?? UNKNOWN,
        subCategoryId: p.subCategoryId,
        subCategoryName: catMap.get(p.subCategoryId)?.category_name ?? UNKNOWN,
        provinceId: p.provinceId,
        provinceName: locNames.provinces.get(p.provinceId) ?? UNKNOWN,
        cityId: p.cityId,
        cityName: locNames.cities.get(p.cityId) ?? UNKNOWN,
        myuserId: p.userId,
        seller: {
          id: p.userId,
          userName: seller?.userName ?? UNKNOWN,
          firstName: seller?.firstName ?? UNKNOWN,
          lastName: seller?.lastName ?? UNKNOWN,
          activePakageType: 0,
          isVerified: seller?.isVerified ?? false,
        },
        isLadder: p.isLadder,
        isElevated: p.isElevated,
        hasVideo: p.hasVideo,
        isOld: p.isOld,
        viewCount: p.viewCount,
        createdAt: fmtDate(p.createdAt),
        updatedAt: fmtDate(p.updatedAt),
        photos,
        photoThumbs: files.map((f) => f.thumbUrl ?? f.url),
      };
    });
  }
}
