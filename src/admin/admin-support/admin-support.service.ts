import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.module';
import { AppError } from '../../common/errors/app-error';
import { USER_SELECT, toUserCard, type UserCard } from '../user-card';
import { UploadsService } from '../../uploads/uploads.service';
import { buildStorage, type StorageDriver } from '../../uploads/storage';
import { validateConversationUpload } from '../../common/file-upload/rules';
import { SUPPORT_EVENTS, emitToUser, isUserOnline } from '../../chat/io-holder';
import { PushService } from '../../push/push.service';
import { SUPPORT_MESSAGE_SELECT, toSupportDto } from '../../support/support.service';
import type { GetSupportThreadListDto, SendSupportReplyDto } from './dto';

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
  private readonly storage: StorageDriver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly push: PushService,
  ) {
    this.storage = buildStorage();
  }

  /** متن پیش‌نمایش پیام در لیست گفتگوها — پیام فایل‌دار با ایموجی نوع */
  private previewOf(m: { text: string; kind: string | null }): string {
    const t = m.text.trim();
    if (t) return t;
    if (m.kind === 'image') return '📷 تصویر';
    if (m.kind === 'video') return '🎬 ویدئو';
    if (m.kind === 'file') return '📎 فایل';
    return t;
  }

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
          text: this.previewOf(m),
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
      select: SUPPORT_MESSAGE_SELECT,
      take: 200,
    });

    return { user: toUserCard(user), messages: messages.map(toSupportDto) };
  }

  // ─── پاسخ پشتیبان ──────────────────────────────────────────────────────────

  /**
   * POST /admin/support/uploadFile — پیوست پاسخ پشتیبان (multipart، سقف ۵MB،
   * قواعد مشترک). بایت‌ها زیر support-admin/<adminId>/ — مالکیت در sendMessage.
   */
  async uploadFile(adminId: string, req: FastifyRequest): Promise<{
    url: string;
    key: string;
    name: string;
    size: number;
    mime: string;
    kind: 'image' | 'video' | 'file';
  }> {
    const { file } = await this.uploads.readMultipart(req);
    if (!file) throw AppError.badRequest('فایل ارسال نشده است.', 'FILE_REQUIRED');

    const { buffer, mimetype, filename } = file;
    const { kind, ext, safeName } = validateConversationUpload(buffer, mimetype, filename);

    const stamp = Date.now().toString(36);
    const rand = randomBytes(5).toString('hex');
    const key = `support-admin/${adminId}/${stamp}-${rand}.${ext}`;
    const url = await this.storage.put(key, buffer, mimetype);

    return { url, key, name: safeName, size: buffer.length, mime: mimetype, kind };
  }

  /** POST /admin/support/sendMessage — پاسخ پشتیبان به کاربر (متن یا فایل + کپشن) */
  async sendMessage(adminUsername: string, adminId: string, userId: string, dto: SendSupportReplyDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return null;

    const kind = dto.kind ?? 'text';
    const hasFile = kind !== 'text';
    const text = (dto.text ?? '').trim();
    if (!hasFile && text.length < 1) return null; // با input فرانت نمی‌رسد — محافظ
    if (hasFile && !dto.fileUrl) {
      throw AppError.badRequest('اطلاعات فایل ناقص است.', 'FILE_META_REQUIRED');
    }
    // مالکیت فایل — کلید باید زیر پوشهٔ خود ادمین باشد (از uploadFile خودش)
    if (hasFile && !dto.fileKey!.startsWith(`support-admin/${adminId}/`)) {
      throw AppError.forbidden('این فایل به شما تعلق ندارد.');
    }

    // ادمین که پاسخ می‌دهد قطعاً پیام‌های قبلی کاربر را دیده — خوانده علامت می‌خورند
    await this.prisma.supportMessage.updateMany({
      where: { userId, senderRole: 'user', readAt: null },
      data: { readAt: new Date() },
    });

    const msg = await this.prisma.supportMessage.create({
      // readAt: null صریح — فیلد optional حذف‌شده با فیلتر null مچ نمی‌شود (الگوی chat.service)
      data: {
        userId,
        senderRole: 'admin',
        adminUsername,
        text,
        readAt: null,
        ...(hasFile
          ? {
              kind,
              fileUrl: dto.fileUrl,
              fileKey: dto.fileKey,
              fileName: dto.fileName?.slice(0, 190) ?? 'فایل',
              fileSize: dto.fileSize ?? 0,
              fileMime: dto.fileMime?.slice(0, 120) ?? 'application/octet-stream',
            }
          : {}),
      },
      select: SUPPORT_MESSAGE_SELECT,
    });

    const message = toSupportDto(msg);

    // ریل‌تایم به کاربر (خواسته مالک ۸-۱۱): صفحهٔ پشتیبانی، بج منو و پیام
    // لینک‌دار «شما یک پیام در پنل پشتیبانی دارید» در چت، همان لحظه تازه می‌شوند
    emitToUser(userId, SUPPORT_EVENTS.NEW_MESSAGE, { message });

    // کاربر آنلاین نیست (سوکت وصل نیست) → اعلان سیستمی وب‌پوش (B10)
    if (!isUserOnline(userId)) {
      const preview = hasFile
        ? kind === 'image'
          ? '📷 تصویر'
          : kind === 'video'
            ? '🎬 ویدئو'
            : '📎 فایل'
        : text.length > 90
          ? `${text.slice(0, 90)}…`
          : text;
      void this.push
        .sendToUser(userId, {
          title: 'پاسخ جدید از پشتیبانی ایمچ',
          body: preview,
          url: '/panel/support',
        })
        .catch(() => undefined); // آتش‌وفراموش — اعلان هرگز پاسخ را نمی‌شکند
    }

    return message;
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
