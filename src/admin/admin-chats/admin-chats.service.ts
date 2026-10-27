import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.module';
import { AppError } from '../../common/errors/app-error';
import type { GetThreadListDto } from './dto';

const OID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * سقف اسکن JS برای فیلتر «در انتظار پاسخ فروشنده».
 * شرط «آخرین پیام از خریدار است و هنوز خوانده نشده» در where پرایسما
 * قابل بیان نیست (ارجاع متقابل senderId == thread.buyerId)؛ پس صف اخیر
 * با پروجکشن سبک (فقط آخرین پیام) اسکن می‌شود. برای مقیاس MVP ادمین
 * (هزاران مکالمه) کاملاً کافی است؛ اگر روزی بزرگ شد → aggregation خام.
 */
const AWAITING_SCAN_CAP = 2000;

/** نام نمایشی: نام کامل → username → موبایل (کاربران seed اغلب بی‌نام‌اند) */
function displayName(u: { firstName: string; lastName: string; userName: string; phone: string }): string {
  const full = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  return full || u.userName || u.phone;
}

export interface UserCard {
  id: string;
  firstName: string;
  lastName: string;
  userName: string;
  phone: string;
  displayName: string;
  isActive: boolean;
  isVerified: boolean;
  lastLoginAt: Date | null;
}

const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  userName: true,
  phone: true,
  isActive: true,
  isVerified: true,
  lastLoginAt: true,
} as const;

function toUserCard(u: {
  id: string;
  firstName: string;
  lastName: string;
  userName: string;
  phone: string;
  isActive: boolean;
  isVerified: boolean;
  lastLoginAt: Date | null;
}): UserCard {
  return { ...u, displayName: displayName(u) };
}

export interface AdminThreadRow {
  id: string;
  product: { id: number; name: string };
  buyer: UserCard;
  seller: UserCard;
  lastMessage: {
    text: string;
    at: Date;
    senderId: string;
    /** خریدار یا فروشنده — برای نشان دادن «آخرین پیام از کی بود» */
    senderRole: 'buyer' | 'seller';
    senderName: string;
    readAt: Date | null;
  } | null;
  messageCount: number;
  /** پیام‌هایی که گیرنده‌شان هنوز نخوانده — نمایش ادمین، تغییردهنده نیست */
  unreadCount: number;
  /** آخرین پیام از خریدار است و فروشنده هنوز نخوانده — «زنگ بزنید به فروشنده» */
  awaitingSellerReply: boolean;
  lastMessageAt: Date | null;
  createdAt: Date;
}

/**
 * چت‌های کاربران — نمای ادمین (فقط خواندنی).
 *
 * چرا این امکان لازم است (مدل MVP ایمچ):
 * کاربران/آگهی‌ها را ما خودمان در دیتابیس می‌ریزیم (SEO)؛ خودشان ثبت‌نام
 * نکرده‌اند. خریدارها پیام می‌دهند؛ ادمین هر روز این لیست را نگاه می‌کند و
 * اگر پیام خوانده‌نشده برای فروشنده‌ای آمده بود به او زنگ می‌زند که بیاید
 * جواب بدهد. بنابراین:
 *   • مرتب‌سازی همیشه بر اساس آخرین پیام (تازه‌ها بالا)
 *   • «خوانده‌نشده» یعنی گیرنده واقعی هنوز نخوانده — نه ادمین
 *   • باز کردن مکالمه توسط ادمین هرگز آن را خوانده‌شده نمی‌کند
 */
@Injectable()
export class AdminChatsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── لیست مکالمات ───────────────────────────────────────────────────────────

  /** POST /admin/chats/getThreadList — تازه‌ترین مکالمات بالا */
  async getThreadList(dto: GetThreadListDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));
    const filter = dto.filter ?? 'all';
    const s = dto.search?.trim();

    const baseWhere = {
      ...(s
        ? {
            OR: [
              { product: { productName: { contains: s } } },
              {
                buyer: {
                  OR: [
                    { phone: { contains: s } },
                    { userName: { contains: s } },
                    { firstName: { contains: s } },
                    { lastName: { contains: s } },
                  ],
                },
              },
              {
                seller: {
                  OR: [
                    { phone: { contains: s } },
                    { userName: { contains: s } },
                    { firstName: { contains: s } },
                    { lastName: { contains: s } },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const include = {
      product: { select: { id: true, productName: true } },
      buyer: { select: USER_SELECT },
      seller: { select: USER_SELECT },
      _count: { select: { messages: true } },
      messages: {
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        select: { text: true, senderId: true, readAt: true, createdAt: true },
      },
    };

    // «در انتظار پاسخ فروشنده» در where قابل بیان نیست → اسکن JS روی صف اخیر
    if (filter === 'awaiting') {
      const rows = await this.prisma.chatThread.findMany({
        where: baseWhere,
        include,
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        take: AWAITING_SCAN_CAP,
      });
      const filtered = rows.filter((t) => {
        const last = t.messages[0];
        return !!last && last.senderId === t.buyerId && last.readAt === null;
      });
      const items = filtered.slice((page - 1) * perPage, page * perPage);
      const unread = await this.unreadMap(items.map((t) => t.id));
      return {
        total: filtered.length,
        page,
        perPage,
        items: items.map((t) => this.toRow(t, unread.get(t.id) ?? 0)),
      };
    }

    const where = {
      ...baseWhere,
      ...(filter === 'unread' ? { messages: { some: { readAt: null } } } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.chatThread.count({ where }),
      this.prisma.chatThread.findMany({
        where,
        include,
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    const unread = await this.unreadMap(rows.map((t) => t.id));
    return {
      total,
      page,
      perPage,
      items: rows.map((t) => this.toRow(t, unread.get(t.id) ?? 0)),
    };
  }

  // ─── پیام‌های یک مکالمه ─────────────────────────────────────────────────────

  /**
   * POST /admin/chats/getThreadMessages — کل پیام‌های مکالمه (ادمین).
   *
   * ⚠️ فقط خواندنی: readAt هیچ‌جا نوشته نمی‌شود — «باز کردن توسط ادمین»
   * به‌عنوان خوانده‌شده تلقی نمی‌شود (خواسته صریح مالک). وضعیت خواندن
   * فقط با باز کردن مکالمه توسط خود کاربر گیرنده تغییر می‌کند.
   */
  async getThreadMessages(threadId: string) {
    if (!OID_RE.test(threadId)) throw AppError.notFound('مکالمه یافت نشد.');

    const thread = await this.prisma.chatThread.findUnique({
      where: { id: threadId },
      include: {
        product: { select: { id: true, productName: true, status: true } },
        buyer: { select: USER_SELECT },
        seller: { select: USER_SELECT },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!thread) throw AppError.notFound('مکالمه یافت نشد.');

    const buyer = toUserCard(thread.buyer);
    const seller = toUserCard(thread.seller);
    const byId = new Map<string, UserCard>([
      [thread.buyerId, buyer],
      [thread.sellerId, seller],
    ]);

    const messages = thread.messages.map((m) => {
      const role: 'buyer' | 'seller' = m.senderId === thread.buyerId ? 'buyer' : 'seller';
      return {
        id: m.id,
        senderId: m.senderId,
        senderRole: role,
        senderName: byId.get(m.senderId)?.displayName ?? 'کاربر حذف‌شده',
        text: m.text,
        readAt: m.readAt,
        createdAt: m.createdAt,
      };
    });

    const last = thread.messages[thread.messages.length - 1] ?? null;

    return {
      thread: {
        id: thread.id,
        product: { id: thread.product.id, name: thread.product.productName, status: thread.product.status },
        buyer,
        seller,
        messageCount: thread.messages.length,
        unreadCount: thread.messages.filter((m) => m.readAt === null).length,
        awaitingSellerReply: !!last && last.senderId === thread.buyerId && last.readAt === null,
        lastMessageAt: thread.lastMessageAt,
        createdAt: thread.createdAt,
      },
      messages,
    };
  }

  // ─── آمار ───────────────────────────────────────────────────────────────────

  /** POST /admin/chats/getChatStats — شمارنده‌های صفحه چت‌ها + داشبورد */
  async getChatStats() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [threads, withUnread, messagesTotal, messagesToday, recent] = await Promise.all([
      this.prisma.chatThread.count(),
      this.prisma.chatThread.count({ where: { messages: { some: { readAt: null } } } }),
      this.prisma.chatMessage.count(),
      this.prisma.chatMessage.count({ where: { createdAt: { gte: startOfDay } } }),
      // اسکن سبک برای «در انتظار پاسخ فروشنده»
      this.prisma.chatThread.findMany({
        where: { lastMessageAt: { not: null } },
        select: {
          buyerId: true,
          messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { senderId: true, readAt: true } },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: AWAITING_SCAN_CAP,
      }),
    ]);

    const awaitingSellerReply = recent.filter(
      (t) => t.messages[0] && t.messages[0].senderId === t.buyerId && t.messages[0].readAt === null,
    ).length;

    return {
      threads,
      withUnread,
      awaitingSellerReply,
      messagesTotal,
      messagesToday,
    };
  }

  // ─── خصوصی ──────────────────────────────────────────────────────────────────

  /** نقشه threadId → تعداد خوانده‌نشده — یک groupBy به‌جای N کوئری */
  private async unreadMap(threadIds: string[]): Promise<Map<string, number>> {
    if (!threadIds.length) return new Map();
    const grouped = await this.prisma.chatMessage.groupBy({
      by: ['threadId'],
      where: { threadId: { in: threadIds }, readAt: null },
      _count: { _all: true },
    });
    return new Map(grouped.map((g) => [g.threadId, g._count._all]));
  }

  private toRow(
    t: {
      id: string;
      createdAt: Date;
      lastMessageAt: Date | null;
      product: { id: number; productName: string };
      buyer: { id: string; firstName: string; lastName: string; userName: string; phone: string; isActive: boolean; isVerified: boolean; lastLoginAt: Date | null };
      seller: { id: string; firstName: string; lastName: string; userName: string; phone: string; isActive: boolean; isVerified: boolean; lastLoginAt: Date | null };
      messages: Array<{ text: string; senderId: string; readAt: Date | null; createdAt: Date }>;
      _count?: { messages: number };
    },
    unreadCount: number,
  ): AdminThreadRow {
    const buyer = toUserCard(t.buyer);
    const seller = toUserCard(t.seller);
    const last = t.messages[0] ?? null;
    const lastSenderRole: 'buyer' | 'seller' =
      last && last.senderId === t.buyer.id ? 'buyer' : 'seller';
    return {
      id: t.id,
      product: { id: t.product.id, name: t.product.productName },
      buyer,
      seller,
      lastMessage: last
        ? {
            text: last.text,
            at: last.createdAt,
            senderId: last.senderId,
            senderRole: lastSenderRole,
            senderName: lastSenderRole === 'buyer' ? buyer.displayName : seller.displayName,
            readAt: last.readAt,
          }
        : null,
      messageCount: t._count?.messages ?? 0,
      unreadCount,
      awaitingSellerReply: !!last && last.senderId === t.buyer.id && last.readAt === null,
      lastMessageAt: t.lastMessageAt,
      createdAt: t.createdAt,
    };
  }
}
