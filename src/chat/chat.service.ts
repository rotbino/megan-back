import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser } from '../common/guards';
import type { FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { CHAT_EVENTS, emitToUser, isUserOnline } from './io-holder';
import { PushService } from '../push/push.service';
import { UploadsService } from '../uploads/uploads.service';
import { buildStorage, type StorageDriver } from '../uploads/storage';
import { validateConversationUpload } from '../common/file-upload/rules';
import {
  EditMessageDto,
  GetThreadMessagesDto,
  MESSAGE_KINDS,
  SendMessageDto,
  StartThreadDto,
} from './dto';

const OID_RE = /^[0-9a-fA-F]{24}$/;

export interface MessageDto {
  id: string;
  threadId: string;
  /** ObjectId فرستنده — کلاینت با userId خودش «من» را تشخیص می‌دهد */
  senderId: string;
  text: string;
  readAt: Date | null;
  createdAt: Date;
  /** نوع پیام — text | image | video | file */
  kind: 'text' | 'image' | 'video' | 'file';
  /** فایل پیوست — null برای پیام متنی */
  file: {
    url: string;
    /** کلید ذخیره‌سازی — فقط داخلی؛ برای حذف سروری هنگام حذف پیام */
    key: string;
    name: string;
    size: number;
    mime: string;
  } | null;
  /** مهر ویرایش — null یعنی دست‌نخورده */
  editedAt: Date | null;
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
 * خواندن: فقط فراخوانی صریح markThreadRead پیام‌های طرف مقابل را readAt می‌زند و به
 * فرستنده رویداد chat:read می‌فرستد (تیک آبی). واکشی پیام‌ها (getThreadMessages)
 * هرگز خوانده نمی‌کند (خواسته مالک ۸-۱۱): بج خوانده‌نشده تا نمایش واقعی پیام‌ها
 * به کاربر باقی می‌ماند — کلاینت بعد از رندر چت open، markThreadRead را صدا می‌زند.
 */
@Injectable()
export class ChatService {
  private readonly storage: StorageDriver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly push: PushService,
    private readonly uploads: UploadsService,
  ) {
    this.storage = buildStorage();
  }

  // ─── آپلود فایل چت (خواسته مالک ۷-۱۱) ─────────────────────────────────────

  /** سقف حجم فایل چت — ۵ مگابایت (قواعد مشترک در common/file-upload/rules) */
  static readonly MAX_FILE_BYTES = 5 * 1024 * 1024;



  /**
   * POST /chat/uploadFile — آپلود پیوست چت (multipart، سقف ۵MB، لیست سفید).
   * خروجی مستقیم به sendMessage می‌رود؛ بایت‌ها زیر chat/<userId>/ ذخیره
   * می‌شوند تا مالکیت فایل در sendMessage قابل اثبات باشد.
   */
  async uploadFile(user: AuthUser, req: FastifyRequest): Promise<{
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
    const key = `chat/${user.id}/${stamp}-${rand}.${ext}`;
    const url = await this.storage.put(key, buffer, mimetype);

    return { url, key, name: safeName, size: buffer.length, mime: mimetype, kind };
  }


  // ─── شفا و یکتاسازی مکالمات (خواسته مالک ۴-۱۱) ────────────────────────────

  /** کلید جفت بی‌جهت — جفت کاربر در هر دو جهت فقط «یک» مکالمه دارد */
  private pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  /** جفت‌های دارای بیش از یک مکالمه — از ردیف‌های داده‌شده */
  private dupPairsOf(rows: Array<{ sellerId: string; buyerId: string }>): Array<{ a: string; b: string }> {
    const groups = new Map<string, { a: string; b: string; n: number }>();
    for (const r of rows) {
      const key = this.pairKey(r.sellerId, r.buyerId);
      const g = groups.get(key);
      if (g) g.n += 1;
      else groups.set(key, { a: r.sellerId, b: r.buyerId, n: 1 });
    }
    return [...groups.values()]
      .filter((g) => g.n > 1)
      .map((g) => ({ a: g.a, b: g.b }));
  }

  /**
   * ادغام مکالمات تکراری یک جفت — هر جفت کاربر در هر دو جهت فقط «یک»
   * مکالمه دارد (خواسته مالک ۴-۱۱: «چت علی و سعید فقط یک‌بار در لیست
   * بیاید»). دادهٔ قدیمیِ نسخه‌های قبلی خودش شفا می‌یابد: پیام‌ها و
   * پیشنهادهای تامینِ تردهای تکراری به مکالمهٔ اصلی (فعال‌ترین) منتقل
   * و تکراری‌ها حذف می‌شوند. شناسهٔ مکالمهٔ اصلی برمی‌گردد (null = جفت
   * بدون مکالمه). ادغام برای همهٔ ورودی‌های چت صدا زده می‌شود؛ در حالت
   * سالم (بدون تکرار) فقط یک findFirst سبک است.
   */
  async healPairThreads(aId: string, bId: string): Promise<string | null> {
    const list = await this.prisma.chatThread.findMany({
      where: { OR: [{ sellerId: aId, buyerId: bId }, { sellerId: bId, buyerId: aId }] },
      select: { id: true, lastMessageAt: true, createdAt: true },
    });
    if (list.length === 0) return null;
    if (list.length === 1) return list[0].id;

    // نگه‌دارنده: فعال‌ترین مکالمه (آخرین پیام؛ سپس جدیدترین ساخت) —
    // مکالمهٔ بی‌پیام هرگز بر مکالمهٔ دارای پیام ترجیح نمی‌خورد
    const activity = (t: { lastMessageAt: Date | null }) => t.lastMessageAt?.getTime() ?? 0;
    const keeper = [...list].sort(
      (x, y) => activity(y) - activity(x) || y.createdAt.getTime() - x.createdAt.getTime(),
    )[0];
    const dupes = list.filter((t) => t.id !== keeper.id).map((t) => t.id);

    // ۱) پیام‌های تردهای تکراری → مکالمهٔ اصلی
    await this.prisma.chatMessage.updateMany({
      where: { threadId: { in: dupes } },
      data: { threadId: keeper.id },
    });
    // ۲) پیشنهادهای تامین (لینک «مشاهدهٔ گفتگو») → مکالمهٔ اصلی
    await this.prisma.supplyOffer.updateMany({
      where: { threadId: { in: dupes } },
      data: { threadId: keeper.id },
    });
    // ۳) lastMessageAt اصلی از آخرین پیام واقعی بازمحاسبه
    const last = await this.prisma.chatMessage.findFirst({
      where: { threadId: keeper.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    await this.prisma.chatThread
      .update({ where: { id: keeper.id }, data: { lastMessageAt: last?.createdAt ?? null } })
      .catch(() => undefined);
    // ۴) حذف تکراری‌های خالی‌شده
    await this.prisma.chatThread.deleteMany({ where: { id: { in: dupes } } });
    return keeper.id;
  }

  /** شفای مکالمات من — جفت‌های تکراریِ من ادغام می‌شوند (معمولاً هیچ) */
  private async healMyThreads(userId: string): Promise<void> {
    const rows = await this.prisma.chatThread.findMany({
      where: { OR: [{ sellerId: userId }, { buyerId: userId }] },
      select: { sellerId: true, buyerId: true },
    });
    for (const { a, b } of this.dupPairsOf(rows)) await this.healPairThreads(a, b);
  }

  /**
   * شفای همهٔ جفت‌های تکراری دیتابیس (سقف‌دار) — نمای «چت‌ها»ی ادمین
   * را شفاف نگه می‌دارد؛ اجرای مکرر بی‌ضرر است (ادغام idempotent است).
   */
  async healAllPairs(scanCap = 2000): Promise<number> {
    const rows = await this.prisma.chatThread.findMany({
      orderBy: { createdAt: 'desc' },
      take: scanCap,
      select: { sellerId: true, buyerId: true },
    });
    const dupes = this.dupPairsOf(rows);
    for (const { a, b } of dupes) await this.healPairThreads(a, b);
    return dupes.length;
  }

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

    // یک مکالمه به‌ازای جفت کاربر (خواسته مالک ۴-۱۱): «اگر سعید دو روز
    // بعد دوباره پیام بدهد، در ادامهٔ همان چت قبلی می‌آید» — عین همهٔ
    // پیامرسان‌ها. جفت در هر دو جهت بررسی می‌شود (فروشنده↔خریدار)، آگهیِ
    // زمینه فقط زمینهٔ نمایش است و با هر شروع تازه به‌روز می‌شود.
    // upsert با کلید مرکب و productId=null در تایپِ where پرایسما جا نمی‌شود
    // (کلید مرکب null قبول نمی‌کند) → find + create با بازیابی از تداخل
    // یکتایی (P2002) — رفتارِ upsert، بدون محدودیت تایپ.
    let thread = await this.prisma.chatThread.findFirst({
      where: {
        OR: [
          { sellerId, buyerId: user.id },
          { sellerId: user.id, buyerId: sellerId },
        ],
      },
      include: threadInclude,
    });
    if (thread) {
      // زمینهٔ مکالمه = آخرین آگهی که گفتگو از روی آن شروع شد (نمایشی فقط)
      if (thread.productId !== productId) {
        try {
          thread = await this.prisma.chatThread.update({
            where: { id: thread.id },
            data: { productId },
            include: threadInclude,
          });
        } catch {
          // تداخل یکتایی نادر (دادهٔ قدیمی تکراری) — زمینهٔ قبلی می‌ماند
        }
      }
    }
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
            where: {
              OR: [
                { sellerId, buyerId: user.id },
                { sellerId: user.id, buyerId: sellerId },
              ],
            },
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

  /** POST /chat/sendMessage — ثبت متن یا فایل + push WS به گیرنده */
  async sendMessage(user: AuthUser, dto: SendMessageDto): Promise<MessageDto> {
    if (!OID_RE.test(dto.threadId)) throw AppError.notFound('مکالمه یافت نشد.');
    const kind: MessageDto['kind'] = dto.kind ?? 'text';
    const hasFile = kind !== 'text';

    const text = (dto.text ?? '').trim();
    if (!hasFile && !text) {
      throw AppError.badRequest('متن پیام خالی است.', 'EMPTY_MESSAGE');
    }
    if (hasFile && (!dto.fileUrl || !dto.fileKey)) {
      throw AppError.badRequest('اطلاعات فایل ناقص است.', 'FILE_META_REQUIRED');
    }
    // مالکیت فایل — کلید باید زیر پوشهٔ خود کاربر باشد (از uploadFile خودش)
    if (hasFile && !dto.fileKey!.startsWith(`chat/${user.id}/`)) {
      throw AppError.forbidden('این فایل به شما تعلق ندارد.');
    }

    let thread = await this.prisma.chatThread.findUnique({
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

    // شناسهٔ کهنهٔ کلاینت (مکالمهٔ تکراریِ قبل از ادغام) → مکالمهٔ اصلی
    // جفت؛ پیام هرگز در تردِ پنهان نمی‌نشیند و حذف نمی‌شود
    {
      const canonicalId = await this.healPairThreads(thread.sellerId, thread.buyerId);
      if (canonicalId && canonicalId !== thread.id) {
        const canonical = await this.prisma.chatThread.findUnique({
          where: { id: canonicalId },
          include: {
            seller: { select: { id: true, firstName: true, lastName: true } },
            buyer: { select: { id: true, firstName: true, lastName: true } },
          },
        });
        if (canonical) thread = canonical;
      }
    }

    const message = await this.prisma.chatMessage.create({
      // ⚠️ readAt باید صریح null نوشته شود — فیلتر «خوانده‌نشده» پرایسما
      // فقط null صریح را می‌گیرد نه فیلد غایب ($ne $$REMOVE در کوئری تولیدی)
      data: {
        threadId: thread.id,
        senderId: user.id,
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
        kind === 'text'
          ? text.length > 90
            ? `${text.slice(0, 90)}…`
            : text
          : kind === 'image'
            ? '📷 تصویر'
            : kind === 'video'
              ? '🎬 ویدئو'
              : '📎 فایل';
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

  // ─── ویرایش/حذف پیام — فقط تا قبل از مشاهدهٔ طرف مقابل (خواسته مالک ۷-۱۱) ──

  /** یافتن پیام خودیِ دیده‌نشده + ترد آن — یا خطای مناسب */
  private async ownUnseenMessage(userId: string, messageId: string) {
    if (!OID_RE.test(messageId)) throw AppError.notFound('پیام یافت نشد.');
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: {
        thread: { select: { id: true, sellerId: true, buyerId: true } },
      },
    });
    if (!message) throw AppError.notFound('پیام یافت نشد.');
    if (message.senderId !== userId) {
      throw AppError.forbidden('این پیام شما نیست.');
    }
    // چت مدرک است — بعد از مشاهدهٔ طرف مقابل پیام قفل می‌شود
    if (message.readAt !== null) {
      throw AppError.forbidden(
        'طرف مقابل این پیام را دیده است؛ پیام‌های دیده‌شده قابل ویرایش یا حذف نیستند.',
        'MESSAGE_SEEN',
      );
    }
    return message;
  }

  /** POST /chat/editMessage — ویرایش متن/کپشن پیام خودیِ دیده‌نشده */
  async editMessage(user: AuthUser, dto: EditMessageDto): Promise<MessageDto> {
    const old = await this.ownUnseenMessage(user.id, dto.messageId);
    const updated = await this.prisma.chatMessage.update({
      where: { id: old.id },
      data: { text: dto.text.trim(), editedAt: new Date() },
    });

    // خبر زنده به طرف مقابل
    const counterpart = old.thread.sellerId === user.id ? old.thread.buyerId : old.thread.sellerId;
    emitToUser(counterpart, CHAT_EVENTS.EDIT, {
      threadId: old.threadId,
      message: this.toMessageDto(updated),
    });

    return this.toMessageDto(updated);
  }

  /** POST /chat/deleteMessage — حذف پیام خودیِ دیده‌نشده + پاک‌کردن فایل از سرور */
  async deleteMessage(user: AuthUser, messageId: string): Promise<{ ok: true }> {
    const message = await this.ownUnseenMessage(user.id, messageId);

    // فایل سرگردان نماند — بایت‌ها بهترین‌حال پاک می‌شوند
    if (message.fileKey) {
      await this.storage.delete(message.fileKey).catch(() => undefined);
    }

    await this.prisma.chatMessage.delete({ where: { id: message.id } });

    // اگر تازه‌ترین پیام ترد بود، lastMessageAt از آخرین پیام باقی‌مانده بازمحاسبه
    const last = await this.prisma.chatMessage.findFirst({
      where: { threadId: message.threadId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    await this.prisma.chatThread
      .update({
        where: { id: message.threadId },
        data: { lastMessageAt: last?.createdAt ?? null },
      })
      .catch(() => undefined);

    const counterpart =
      message.thread.sellerId === user.id ? message.thread.buyerId : message.thread.sellerId;
    emitToUser(counterpart, CHAT_EVENTS.DELETE, {
      threadId: message.threadId,
      messageId: message.id,
    });

    return { ok: true };
  }


  /** POST /chat/getThreadMessages — پیام‌ها (صعودی)؛ واکشی ≠ خواندن (خواسته مالک ۸-۱۱) */
  async getThreadMessages(user: AuthUser, dto: GetThreadMessagesDto): Promise<MessageDto[]> {
    let thread = await this.prisma.chatThread.findUnique({ where: { id: dto.threadId } });
    if (!thread) throw AppError.notFound('مکالمه یافت نشد.');
    if (thread.sellerId !== user.id && thread.buyerId !== user.id) {
      throw AppError.forbidden('شما عضو این مکالمه نیستید.');
    }

    // شناسهٔ کهنه (ترد تکراریِ قبل از ادغام) → مکالمهٔ اصلی جفت
    {
      const canonicalId = await this.healPairThreads(thread.sellerId, thread.buyerId);
      if (canonicalId && canonicalId !== thread.id) {
        const canonical = await this.prisma.chatThread.findUnique({ where: { id: canonicalId } });
        if (canonical) thread = canonical;
      }
    }

    // پیجینگ درخواسته مالک ۷-۱۱: ۲۰ پیام آخر؛ با before صفحات قبلی‌تر
    const take = Math.min(50, Math.max(1, dto.take ?? 20));

    // واکشی بدون خواندن (خواسته مالک ۸-۱۱) — بج خوانده‌نشده تا زمانی که کلاینت
    // چت را واقعاً نمایش داد و markThreadRead را صریحاً صدا زد باقی می‌ماند؛
    // پیام‌های خوانده‌نشده با readAt=null برمی‌گردند تا اسکرول روی اولین
    // پیام خوانده‌نشده متوقف شود.

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
    let thread = await this.prisma.chatThread.findUnique({ where: { id: threadId } });
    if (!thread) throw AppError.notFound('مکالمه یافت نشد.');
    if (thread.sellerId !== user.id && thread.buyerId !== user.id) {
      throw AppError.forbidden('شما عضو این مکالمه نیستید.');
    }
    // شناسهٔ کهنه → مکالمهٔ اصلی جفت (خواندن روی مکالمهٔ واقعی ثبت شود)
    {
      const canonicalId = await this.healPairThreads(thread.sellerId, thread.buyerId);
      if (canonicalId && canonicalId !== thread.id) {
        const canonical = await this.prisma.chatThread.findUnique({ where: { id: canonicalId } });
        if (canonical) thread = canonical;
      }
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
    // شفای خودکار — دادهٔ قدیمیِ تکراری (جفت در دو جهت، نسخه‌های قبلی)
    // همان‌جا ادغام می‌شود تا هر مخاطب فقط یک‌بار در لیست بیاید
    await this.healMyThreads(user.id);

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
    let thread = await this.prisma.chatThread.findUnique({
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
    // شناسهٔ کهنه → مکالمهٔ اصلی جفت
    {
      const canonicalId = await this.healPairThreads(thread.sellerId, thread.buyerId);
      if (canonicalId && canonicalId !== thread.id) {
        const canonical = await this.prisma.chatThread.findUnique({
          where: { id: canonicalId },
          include: {
            seller: { select: { id: true, firstName: true, lastName: true, userName: true, avatarUrl: true } },
            buyer: { select: { id: true, firstName: true, lastName: true, userName: true, avatarUrl: true } },
            product: { select: { id: true, productName: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        });
        if (canonical) thread = canonical;
      }
    }
    const unreadCount = await this.prisma.chatMessage.count({
      where: { threadId: thread.id, senderId: { not: user.id }, readAt: null },
    });
    return this.toThreadDto(thread, user.id, unreadCount);
  }

  // ─── پیام‌های پشتیبانی (ادمین → کاربر) ────────────────────────────────────

  /**
   * POST /chat/unreadCount — بج هدر/فوتر/منوها:
   *  • chat — پیام‌های خوانده‌نشدهٔ مکالمات
   *  • support — پیام‌های مستقیم پشتیبانی (AdminMessage)
   *  • ticket — پاسخ‌های خوانده‌نشدهٔ گفتگوی پشتیبانی (خواسته مالک ۸-۱۱:
   *    بج قرمز منوی «پشتیبانی» + پیام لینک‌دار در چت)
   *  • count — مجموع هر سه (قیف کشف: بج → چت → لینک → تیکت)
   */
  async getUnreadCount(
    user: AuthUser,
  ): Promise<{ count: number; chat: number; support: number; ticket: number }> {
    // شفای خودکار + یک کوئری: جفت تکراری ادغام و همان ردیف‌ها بج را می‌سازند
    // (۵۰۰ مکالمه اخیر — بج «پیام جدید» است؛ نخ‌های خفته قدیمی بی‌اثرند)
    let rows = await this.prisma.chatThread.findMany({
      where: { OR: [{ sellerId: user.id }, { buyerId: user.id }] },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true, sellerId: true, buyerId: true },
      take: 500,
    });
    const dupPairs = this.dupPairsOf(rows);
    if (dupPairs.length > 0) {
      for (const { a, b } of dupPairs) await this.healPairThreads(a, b);
      rows = await this.prisma.chatThread.findMany({
        where: { OR: [{ sellerId: user.id }, { buyerId: user.id }] },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true, sellerId: true, buyerId: true },
        take: 500,
      });
    }

    const [chat, support, ticket] = await Promise.all([
      rows.length
        ? this.prisma.chatMessage.count({
            where: {
              threadId: { in: rows.map((t) => t.id) },
              senderId: { not: user.id },
              readAt: null,
            },
          })
        : Promise.resolve(0),
      this.prisma.adminMessage.count({ where: { userId: user.id, readAt: null } }),
      this.prisma.supportMessage.count({ where: { userId: user.id, senderRole: 'admin', readAt: null } }),
    ]);

    return { count: chat + support + ticket, chat, support, ticket };
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
    kind?: string | null;
    fileUrl?: string | null;
    fileKey?: string | null;
    fileName?: string | null;
    fileSize?: number | null;
    fileMime?: string | null;
    editedAt?: Date | null;
  }): MessageDto {
    const kind = (MESSAGE_KINDS as readonly string[]).includes(m.kind ?? 'text')
      ? ((m.kind ?? 'text') as MessageDto['kind'])
      : 'text';
    return {
      id: m.id,
      threadId: m.threadId,
      senderId: m.senderId,
      text: m.text,
      readAt: m.readAt,
      createdAt: m.createdAt,
      kind,
      file:
        m.fileUrl && m.fileKey
          ? {
              url: m.fileUrl,
              key: m.fileKey,
              name: m.fileName ?? 'فایل',
              size: m.fileSize ?? 0,
              mime: m.fileMime ?? 'application/octet-stream',
            }
          : null,
      editedAt: m.editedAt ?? null,
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
      messages: Array<{ text: string; createdAt: Date; senderId: string; kind?: string | null }>;
    },
    myId: string,
    unreadCount: number,
  ): ThreadDto {
    const myRole: 'buyer' | 'seller' = t.sellerId === myId ? 'seller' : 'buyer';
    const counterpart = myRole === 'buyer' ? t.seller : t.buyer;
    const last = t.messages[0];
    // پیش‌نمایش لیست مکالمات — پیام فایل‌دار بدون کپشن برچسب نوع می‌گیرد
    const previewOf = (m: { text: string; kind?: string | null }) =>
      m.text.trim() ||
      (m.kind === 'image' ? '📷 تصویر' : m.kind === 'video' ? '🎬 ویدئو' : m.kind === 'file' ? '📎 فایل' : '');
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
      lastMessage: last
        ? { text: previewOf(last) || 'بدون پیام', at: last.createdAt, senderId: last.senderId }
        : null,
      unreadCount,
      updatedAt: t.updatedAt,
    };
  }
}
