import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.module';
import { USER_SELECT, toUserCard, type UserCard } from '../user-card';
import type { GetSupportThreadListDto } from './dto';

/**
 * سقف اسکن JS برای ساخت لیست گفتگوها — آخرین پیام هر کاربر در where
 * پرایسما قابل بیان نیست (ارجاع متقابل گروه/تاریخ)؛ پس صف اخیر با
 * پروجکشن سبک اسکن می‌شود (الگوی AWAITING_SCAN_CAP در admin-chats).
 * برای مقیاس MVP (هزاران پیام) کاملاً کافی است.
 */
const RECENT_SCAN_CAP = 2000;

export interface AdminSupportThreadRow {
  /** شناسه کاربر — کلید گفتگو (هر کاربر یک گفتگوی پیوسته) */
  userId: string;
  user: UserCard;
  lastMessage: {
    text: string;
    at: Date;
    /** user | admin — آخرین پیام از کی بود */
    senderRole: 'user' | 'admin';
    adminUsername: string | null;
  } | null;
  messageCount: number;
  /** پیام‌های کاربر که پشتیبان هنوز ندیده — باز کردن گفتگو صفر می‌کند */
  unreadCount: number;
  /** آخرین پیام از کاربر است — گفتگو نیازمند پاسخ پشتیبان */
  awaitingReply: boolean;
  lastMessageAt: Date | null;
}

/**
 * چت‌های پشتیبانی — نمای ادمین (پاسخ‌دهنده، برخلاف admin-chats تماشاگر).
 *
 * مدل: هر کاربر یک گفتگوی پیوسته با پشتیبانی دارد (MVP بدون تیکت).
 *  • «خوانده‌نشده» یعنی پشتیبان هنوز باز نکرده — باز کردن گفتگو توسط
 *    ادمین پیام‌های کاربر را خوانده‌شده می‌کند (ادمین گیرندهٔ واقعی است).
 *  • «در انتظار پاسخ» یعنی آخرین پیام از کاربر است — صرف‌نظر از خوانده‌شدن؛
 *    این صف در داشبورد و بج منو می‌آید.
 */
@Injectable()
export class AdminSupportService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── لیست گفتگوها ───────────────────────────────────────────────────────────

  /** POST /admin/support/getThreadList — تازه‌ترین گفتگوها بالا */
  async getThreadList(dto: GetSupportThreadListDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));
    const filter = dto.filter ?? 'all';
    const s = dto.search?.trim();

    // صف اخیر + کارت کاربر — آخرین پیام هر کاربر از دل همان می‌آید
    const recent = await this.prisma.supportMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: RECENT_SCAN_CAP,
      include: { user: { select: USER_SELECT } },
      ...(s
        ? {
            where: {
              user: {
                OR: [
                  { phone: { contains: s } },
                  { userName: { contains: s } },
                  { firstName: { contains: s } },
                  { lastName: { contains: s } },
                ],
              },
            },
          }
        : {}),
    });

    // گروه‌بندی در حافظه: هر کاربر یک ردیف (اولین دیدار = آخرین پیام)
    const byUser = new Map<string, AdminSupportThreadRow>();
    for (const m of recent) {
      const existing = byUser.get(m.userId);
      if (existing) {
        if (!existing.lastMessageAt) existing.lastMessageAt = m.createdAt;
        continue; // آخرین پیام قبلاً ست شده
      }
      byUser.set(m.userId, {
        userId: m.userId,
        user: toUserCard(m.user),
        lastMessage: {
          text: m.text,
          at: m.createdAt,
          senderRole: m.senderRole === 'user' ? 'user' : 'admin',
          adminUsername: m.adminUsername ?? null,
        },
        messageCount: 0, // از groupBy دقیق پر می‌شود
        unreadCount: 0, // از groupBy دقیق پر می‌شود
        awaitingReply: m.senderRole === 'user',
        lastMessageAt: m.createdAt,
      });
    }

    // شمارش دقیق: کل پیام‌ها + خوانده‌نشده‌های کاربر per-user
    const userIds = [...byUser.keys()];
    if (userIds.length > 0) {
      const [counts, unreads] = await Promise.all([
        this.prisma.supportMessage.groupBy({
          by: ['userId'],
          where: { userId: { in: userIds } },
          _count: { _all: true },
        }),
        this.prisma.supportMessage.groupBy({
          by: ['userId'],
          where: { userId: { in: userIds }, senderRole: 'user', readAt: null },
          _count: { _all: true },
        }),
      ]);
      const countMap = new Map(counts.map((g) => [g.userId, g._count._all]));
      const unreadMap = new Map(unreads.map((g) => [g.userId, g._count._all]));
      for (const row of byUser.values()) {
        row.messageCount = countMap.get(row.userId) ?? 0;
        row.unreadCount = unreadMap.get(row.userId) ?? 0;
      }
    }

    let rows = [...byUser.values()].sort(
      (a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0),
    );

    if (filter === 'unread') rows = rows.filter((r) => r.unreadCount > 0);
    if (filter === 'awaiting') rows = rows.filter((r) => r.awaitingReply);

    return {
      total: rows.length,
      page,
      perPage,
      items: rows.slice((page - 1) * perPage, page * perPage),
    };
  }

  // ─── پیام‌های یک گفتگو ─────────────────────────────────────────────────────

  /**
   * POST /admin/support/getThreadMessages — کل گفتگوی یک کاربر.
   * برخلاف admin-chats (تماشاگر)، اینجا ادمین گیرندهٔ واقعی است: باز کردن
   * گفتگو پیام‌های خوانده‌نشدهٔ کاربر را خوانده‌شده می‌کند (بج صفر می‌شود).
   */
  async getThreadMessages(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    if (!user) return null;

    // خواندن واقعی توسط ادمین — پیام‌های کاربر خوانده‌شده علامت می‌خورند
    await this.prisma.supportMessage.updateMany({
      where: { userId, senderRole: 'user', readAt: null },
      data: { readAt: new Date() },
    });

    const messages = await this.prisma.supportMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        senderRole: true,
        adminUsername: true,
        text: true,
        readAt: true,
        createdAt: true,
      },
      take: 200,
    });

    return { user: toUserCard(user), messages };
  }

  // ─── پاسخ پشتیبان ──────────────────────────────────────────────────────────

  /** POST /admin/support/sendMessage — پاسخ پشتیبان به کاربر */
  async sendMessage(adminUsername: string, userId: string, text: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return null;

    // ادمین که پاسخ می‌دهد قطعاً پیام‌های قبلی کاربر را دیده — خوانده علامت می‌خورند
    await this.prisma.supportMessage.updateMany({
      where: { userId, senderRole: 'user', readAt: null },
      data: { readAt: new Date() },
    });

    const msg = await this.prisma.supportMessage.create({
      // readAt: null صریح — فیلد optional حذف‌شده با فیلتر null مچ نمی‌شود (الگوی chat.service)
      data: { userId, senderRole: 'admin', adminUsername, text: text.trim(), readAt: null },
    });
    return {
      id: msg.id,
      senderRole: 'admin' as const,
      adminUsername: msg.adminUsername,
      text: msg.text,
      readAt: msg.readAt,
      createdAt: msg.createdAt,
    };
  }

  // ─── آمار (صفحه + داشبورد + بج منو) ────────────────────────────────────────

  /**
   * POST /admin/support/getStats — شمارنده‌ها:
   *  • threads — کاربران دارای گفتگو
   *  • unreadMessages — پیام‌های کاربر که پشتیبان ندیده (بج منو)
   *  • awaitingReply — گفتگوهای نیازمند پاسخ (داشبورد/صف)
   *  • messagesToday / messagesTotal
   */
  async getStats() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [threadGroups, unreadMessages, messagesTotal, messagesToday, recent] = await Promise.all([
      this.prisma.supportMessage.groupBy({
        by: ['userId'],
        _count: { _all: true },
      }),
      this.prisma.supportMessage.count({ where: { senderRole: 'user', readAt: null } }),
      this.prisma.supportMessage.count(),
      this.prisma.supportMessage.count({ where: { createdAt: { gte: startOfDay } } }),
      // اسکن سبک برای «آخرین پیام از کاربر» (در انتظار پاسخ)
      this.prisma.supportMessage.findMany({
        orderBy: { createdAt: 'desc' },
        take: RECENT_SCAN_CAP,
        select: { userId: true, senderRole: true },
      }),
    ]);

    // آخرین پیام هر کاربر — اولین دیدار در فهرست نزولی
    const lastFromUser = new Map<string, boolean>();
    for (const m of recent) {
      if (!lastFromUser.has(m.userId)) lastFromUser.set(m.userId, m.senderRole === 'user');
    }

    return {
      threads: threadGroups.length,
      unreadMessages,
      awaitingReply: [...lastFromUser.values()].filter(Boolean).length,
      messagesTotal,
      messagesToday,
    };
  }
}
