import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser } from '../common/guards';
import { CHAT_EVENTS, emitToUser, isUserOnline } from './io-holder';
import { PushService } from '../push/push.service';
import { GetThreadMessagesDto, SendMessageDto, StartThreadDto } from './dto';

const OID_RE = /^[0-9a-fA-F]{24}$/;

export interface MessageDto {
  id: string;
  threadId: string;
  /** ObjectId فرستنده — کلاینت با userId خودش «من» را تشخیص می‌دهد */
  senderId: string;
  text: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface ThreadDto {
  id: string;
  /** آگهی زمینه — null یعنی گفتگوی مستقیم از پروفایل فروشنده */
  productId: number | null;
  /** نام آگهی زمینه — null برای گفتگوی مستقیم (کلاینت «گفتگو با فروشنده» می‌گذارد) */
  productName: string | null;
  /** ObjectId کاربر جاری — کلاینت «من» را در پیام‌ها تشخیص می‌دهد */
  myId: string;
  /** نقش من در مکالمه */
  myRole: 'buyer' | 'seller';
  counterpart: {
    id: string;
    firstName: string;
    lastName: string;
    userName: string;
    /** آواتار طرف مقابل — در هدر مکالمه و حباب‌های پیام نمایش داده می‌شود */
    avatarUrl: string | null;
  };
  lastMessage: { text: string; at: Date; senderId: string } | null;
  unreadCount: number;
  updatedAt: Date;
}

/** پیام پشتیبانی (ادمین → کاربر) — یک‌طرفه؛ camelCase عین MessageDto */
export interface AdminMessageDto {
  id: string;
  text: string;
  adminUsername: string;
  readAt: Date | null;
  createdAt: Date;
}

/** صندوق پیام‌های پشتیبانی من — items صعودی (قدیمی → جدید) */
export interface AdminInboxDto {
  items: AdminMessageDto[];
  total: number;
  unread: number;
}

/**
 * ─── چت و پیام‌ها (B8) ───────────────────────────────────────────────────────
 * مکالمه خریدار ↔ فروشنده روی یک آگهی (عین باسکول). REST برای همه عملیات +
 * WebSocket (socket.io) فقط برای push لحظه‌ای پیام تازه به گیرنده.
 * خواندن: باز کردن مکالمه پیام‌های طرف مقابل را readAt می‌زند و به فرستنده
 * رویداد chat:read می‌فرستد (تیک آبی).
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly push: PushService,
  ) {}

  // ─── اتصال WS ──────────────────────────────────────────────────────────────

  /** اعتبارسنجی توکن handshake سوکت — از JwtModule مشترک */
  async verifySocketToken(token: string): Promise<string | null> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      return payload?.sub ?? null;
    } catch {
      return null;
    }
  }

  // ─── شروع مکالمه ───────────────────────────────────────────────────────────

  /** POST /chat/startThread — یافتن/ساخت مکالمه من + آگهی یا مستقیم با فروشنده */
  async startThread(user: AuthUser, dto: StartThreadDto): Promise<ThreadDto> {
    let sellerId: string;
    let productId: number | null = null;

    if (dto.productId != null) {
      // مسیر آگهی — مکالمه درباره یک محصول مشخص
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: { id: true, productName: true, status: true, userId: true },
      });
      if (!product || product.status !== 'confirmed') {
        throw AppError.notFound('محصول یافت نشد.');
      }
      if (product.userId === user.id) {
        throw AppError.badRequest('این آگهی متعلق به خودتان است.', 'SELF_CHAT');
      }
      sellerId = product.userId;
      productId = product.id;
    } else {
      // مسیر پروفایل — گفتگوی مستقیم با فروشنده (بدون آگهی زمینه)
      if (!dto.userName?.trim()) {
        throw AppError.badRequest('آگهی یا شناسه فروشنده لازم است.', 'THREAD_TARGET_REQUIRED');
      }
      const seller = await this.prisma.user.findUnique({
        where: { userName: dto.userName.trim() },
        select: { id: true, isActive: true },
      });
      if (!seller || !seller.isActive) throw AppError.notFound('فروشنده یافت نشد.');
      if (seller.id === user.id) {
        throw AppError.badRequest('گفتگو با خودتان معنا ندارد.', 'SELF_CHAT');
      }
      sellerId = seller.id;
    }

    const threadInclude = {
      product: { select: { productName: true } },
      seller: { select: { id: true, firstName: true, lastName: true, userName: true, avatarUrl: true } },
      buyer: { select: { id: true, firstName: true, lastName: true, userName: true, avatarUrl: true } },
      messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
    };

    // upsert با کلید مرکب و productId=null در تایپِ where پرایسما جا نمی‌شود
    // (کلید مرکب null قبول نمی‌کند) → find + create با بازیابی از تداخل
    // یکتایی (P2002) — رفتارِ upsert، بدون محدودیت تایپ.
    // productId=null در where عادی به null/missing مونگو می‌خورد — درست است.
    let thread = await this.prisma.chatThread.findFirst({
      where: { sellerId, buyerId: user.id, productId },
      include: threadInclude,
    });
    if (!thread) {
      try {
        thread = await this.prisma.chatThread.create({
          data: { productId, sellerId, buyerId: user.id },
          include: threadInclude,
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          e.meta?.target
        ) {
          // مکالمه همزمان ساخته شد (دو تب) — همان را برگردان
          thread = await this.prisma.chatThread.findFirstOrThrow({
            where: { sellerId, buyerId: user.id, productId },
            include: threadInclude,
          });
        } else {
          throw e;
        }
      }
    }

    const unreadCount = await this.prisma.chatMessage.count({
      where: { threadId: thread.id, senderId: { not: user.id }, readAt: null },
    });

    return this.toThreadDto(thread, user.id, unreadCount);
  }

  // ─── پیام‌ها ────────────────────────────────────────────────────────────────

  /** POST /chat/sendMessage — ثبت + push WS به گیرنده */
  async sendMessage(user: AuthUser, dto: SendMessageDto): Promise<MessageDto> {
    if (!OID_RE.test(dto.threadId)) throw AppError.notFound('مکالمه یافت نشد.');
    const thread = await this.prisma.chatThread.findUnique({
      where: { id: dto.threadId },
      include: {
        seller: { select: { id: true, firstName: true, lastName: true } },
        buyer: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!thread) throw AppError.notFound('مکالمه یافت نشد.');
    if (thread.sellerId !== user.id && thread.buyerId !== user.id) {
      throw AppError.forbidden('شما عضو این مکالمه نیستید.');
    }

    const message = await this.prisma.chatMessage.create({
      // ⚠️ readAt باید صریح null نوشته شود — فیلتر «خوانده‌نشده» پرایسما
      // فقط null صریح را می‌گیرد نه فیلد غایب ($ne $$REMOVE در کوئری تولیدی)
      data: { threadId: thread.id, senderId: user.id, text: dto.text.trim(), readAt: null },
    });
    await this.prisma.chatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: message.createdAt },
    });

    // push به گیرنده (طرف مقابل) — اتاق شخصی‌اش
    const receiverId = thread.sellerId === user.id ? thread.buyerId : thread.sellerId;
    const senderName =
      thread.sellerId === user.id
        ? `${thread.seller.firstName} ${thread.seller.lastName}`.trim()
        : `${thread.buyer.firstName} ${thread.buyer.lastName}`.trim();
    emitToUser(receiverId, CHAT_EVENTS.NEW_MESSAGE, {
      threadId: thread.id,
      message: this.toMessageDto(message),
      senderName: senderName || 'کاربر ایمچ',
      productName: undefined,
    });

    // گیرنده آنلاین نیست (سوکت وصل نیست) → اعلان سیستمی وب‌پوش (B10)
    if (!isUserOnline(receiverId)) {
      const preview =
        dto.text.trim().length > 90 ? `${dto.text.trim().slice(0, 90)}…` : dto.text.trim();
      void this.push
        .sendToUser(receiverId, {
          title: `پیام جدید از ${senderName || 'کاربر ایمچ'}`,
          body: preview,
          url: '/panel/messages',
        })
        .catch(() => undefined); // آتش‌وفراموش — اعلان هرگز ارسال پیام را نمی‌شکند
    }

    return this.toMessageDto(message);
  }

  /** POST /chat/getThreadMessages — پیام‌ها (صعودی) + خواندن طرف مقابل */
  async getThreadMessages(user: AuthUser, dto: GetThreadMessagesDto): Promise<MessageDto[]> {
    const thread = await this.prisma.chatThread.findUnique({ where: { id: dto.threadId } });
    if (!thread) throw AppError.notFound('مکالمه یافت نشد.');
    if (thread.sellerId !== user.id && thread.buyerId !== user.id) {
      throw AppError.forbidden('شما عضو این مکالمه نیستید.');
    }

    const take = Math.min(50, Math.max(1, dto.take ?? 50));

    // اول خواندن (پیام‌های طرف مقابل) بعد واکشی — پاسخ readAt تازه برمی‌گرداند
    await this.markRead(thread, user);

    const messages = await this.prisma.chatMessage.findMany({
      where: {
        threadId: thread.id,
        ...(dto.before ? { createdAt: { lt: new Date(dto.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return messages.reverse().map((m) => this.toMessageDto(m));
  }

  /** POST /chat/markThreadRead — علامت خوانده‌شدن بدون واکشی */
  async markThreadRead(user: AuthUser, threadId: string): Promise<{ read: number }> {
    if (!OID_RE.test(threadId)) throw AppError.notFound('مکالمه یافت نشد.');
    const thread = await this.prisma.chatThread.findUnique({ where: { id: threadId } });
    if (!thread) throw AppError.notFound('مکالمه یافت نشد.');
    if (thread.sellerId !== user.id && thread.buyerId !== user.id) {
      throw AppError.forbidden('شما عضو این مکالمه نیستید.');
    }
    return { read: await this.markRead(thread, user) };
  }

  /**
   * خواندن پیام‌های طرف مقابل + رویداد «تیک آبی» به فرستنده‌شان
   * (طرف مقابل مکالمه — نه خودِ خواننده).
   */
  private async markRead(
    thread: { id: string; sellerId: string; buyerId: string },
    user: AuthUser,
  ): Promise<number> {
    const read = await this.prisma.chatMessage.updateMany({
      where: { threadId: thread.id, senderId: { not: user.id }, readAt: null },
      data: { readAt: new Date() },
    });
    if (read.count > 0) {
      const counterpart = thread.sellerId === user.id ? thread.buyerId : thread.sellerId;
      emitToUser(counterpart, CHAT_EVENTS.READ, { threadId: thread.id, by: user.id });
    }
    return read.count;
  }

  // ─── لیست مکالمات ──────────────────────────────────────────────────────────

  /** POST /chat/getConversations — مکالمات من با آخرین پیام + خوانده‌نشده */
  async getConversations(user: AuthUser): Promise<ThreadDto[]> {
    const threads = await this.prisma.chatThread.findMany({
      where: { OR: [{ sellerId: user.id }, { buyerId: user.id }] },
      // مونگو: desc مقادیر null/missing را آخر می‌گذارد — دقیقاً سورت مطلوب
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      take: 100,
      include: {
        seller: { select: { id: true, firstName: true, lastName: true, userName: true, avatarUrl: true } },
        buyer: { select: { id: true, firstName: true, lastName: true, userName: true, avatarUrl: true } },
        product: { select: { id: true, productName: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    const unread = await this.prisma.chatMessage.groupBy({
      by: ['threadId'],
      where: {
        threadId: { in: threads.map((t) => t.id) },
        senderId: { not: user.id },
        readAt: null,
      },
      _count: { id: true },
    });
    const unreadMap = new Map(unread.map((u) => [u.threadId, u._count.id]));

    return threads.map((t) => this.toThreadDto(t, user.id, unreadMap.get(t.id) ?? 0));
  }

  /** POST /chat/getThread — یک مکالمه (بدون پیام‌ها) */
  async getThread(user: AuthUser, threadId: string): Promise<ThreadDto> {
    if (!OID_RE.test(threadId)) throw AppError.notFound('مکالمه یافت نشد.');
    const thread = await this.prisma.chatThread.findUnique({
      where: { id: threadId },
      include: {
        seller: { select: { id: true, firstName: true, lastName: true, userName: true, avatarUrl: true } },
        buyer: { select: { id: true, firstName: true, lastName: true, userName: true, avatarUrl: true } },
        product: { select: { id: true, productName: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!thread) throw AppError.notFound('مکالمه یافت نشد.');
    if (thread.sellerId !== user.id && thread.buyerId !== user.id) {
      throw AppError.forbidden('شما عضو این مکالمه نیستید.');
    }
    const unreadCount = await this.prisma.chatMessage.count({
      where: { threadId: thread.id, senderId: { not: user.id }, readAt: null },
    });
    return this.toThreadDto(thread, user.id, unreadCount);
  }

  // ─── پیام‌های پشتیبانی (ادمین → کاربر) ────────────────────────────────────

  /** POST /chat/unreadCount — بج هدر/فوتر: مجموع خوانده‌نشده چت + پشتیبانی */
  async getUnreadCount(user: AuthUser): Promise<{ count: number; chat: number; support: number }> {
    // ۵۰۰ مکالمه اخیر — بج «پیام جدید» است؛ نخ‌های خفته قدیمی بی‌اثرند
    const threads = await this.prisma.chatThread.findMany({
      where: { OR: [{ sellerId: user.id }, { buyerId: user.id }] },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
      take: 500,
    });

    const [chat, support] = await Promise.all([
      threads.length
        ? this.prisma.chatMessage.count({
            where: {
              threadId: { in: threads.map((t) => t.id) },
              senderId: { not: user.id },
              readAt: null,
            },
          })
        : Promise.resolve(0),
      this.prisma.adminMessage.count({ where: { userId: user.id, readAt: null } }),
    ]);

    return { count: chat + support, chat, support };
  }

  /** POST /chat/getMyAdminMessages — آخرین پیام‌های پشتیبانی من (صعودی) + خوانده‌نشده */
  async getMyAdminMessages(user: AuthUser): Promise<AdminInboxDto> {
    const [total, unread, rows] = await Promise.all([
      this.prisma.adminMessage.count({ where: { userId: user.id } }),
      this.prisma.adminMessage.count({ where: { userId: user.id, readAt: null } }),
      this.prisma.adminMessage.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50, // صندوق ورودی اطلاع‌رسانی است — ۵۰ پیام آخر کافی است
      }),
    ]);
    return {
      items: rows.reverse().map((m) => this.toAdminMessageDto(m)),
      total,
      unread,
    };
  }

  /** POST /chat/markMyAdminMessagesRead — باز کردن مکالمه پشتیبانی = خواندن */
  async markMyAdminMessagesRead(user: AuthUser): Promise<{ read: number }> {
    const r = await this.prisma.adminMessage.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: r.count };
  }

  // ─── داخلی ─────────────────────────────────────────────────────────────────

  private toMessageDto(m: {
    id: string;
    threadId: string;
    senderId: string;
    text: string;
    readAt: Date | null;
    createdAt: Date;
  }): MessageDto {
    return {
      id: m.id,
      threadId: m.threadId,
      senderId: m.senderId,
      text: m.text,
      readAt: m.readAt,
      createdAt: m.createdAt,
    };
  }

  private toAdminMessageDto(m: {
    id: string;
    text: string;
    adminUsername: string;
    readAt: Date | null;
    createdAt: Date;
  }): AdminMessageDto {
    return {
      id: m.id,
      text: m.text,
      adminUsername: m.adminUsername,
      readAt: m.readAt,
      createdAt: m.createdAt,
    };
  }

  private toThreadDto(
    t: {
      id: string;
      productId: number | null;
      sellerId: string;
      buyerId: string;
      updatedAt: Date;
      product: { productName: string } | null;
      seller: { id: string; firstName: string; lastName: string; userName: string; avatarUrl: string | null };
      buyer: { id: string; firstName: string; lastName: string; userName: string; avatarUrl: string | null };
      messages: Array<{ text: string; createdAt: Date; senderId: string }>;
    },
    myId: string,
    unreadCount: number,
  ): ThreadDto {
    const myRole: 'buyer' | 'seller' = t.sellerId === myId ? 'seller' : 'buyer';
    const counterpart = myRole === 'buyer' ? t.seller : t.buyer;
    const last = t.messages[0];
    return {
      id: t.id,
      productId: t.productId,
      productName: t.product?.productName ?? null,
      myId,
      myRole,
      counterpart: {
        id: counterpart.id,
        firstName: counterpart.firstName,
        lastName: counterpart.lastName,
        userName: counterpart.userName,
        avatarUrl: counterpart.avatarUrl ?? null,
      },
      lastMessage: last ? { text: last.text, at: last.createdAt, senderId: last.senderId } : null,
      unreadCount,
      updatedAt: t.updatedAt,
    };
  }
}
