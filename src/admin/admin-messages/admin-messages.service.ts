import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.module';
import { AppError } from '../../common/errors/app-error';
import { PushService } from '../../push/push.service';
import { CHAT_EVENTS, emitToUser, isUserOnline } from '../../chat/io-holder';
import { USER_SELECT, toUserCard, type UserCard } from '../user-card';
import type {
  GetUserMessagesDto,
  SendToAllDto,
  SendToUserDto,
  SendToUsersDto,
} from './dto';

const OID_RE = /^[0-9a-fA-F]{24}$/;

/** ردیف تاریخچه سمت ادمین — snake_case عین بقیه ردیف‌های پنل ادمین */
export interface AdminMessageRow {
  id: string;
  user_id: string;
  admin_username: string;
  text: string;
  read_at: Date | null;
  created_at: Date;
}

/** دستهٔ ارسال در «آخرین ارسال‌ها» (خواستهٔ مالک ۸-۱۱ دور ۲۴) */
export interface AdminSendBatch {
  batchId: string;
  text: string;
  adminUsername: string;
  /** لحظهٔ ارسال (جدیدترین ردیف دسته) */
  at: Date;
  /** شمار گیرندگان دسته */
  total: number;
  /** چند نفر خوانده‌اند */
  read: number;
  /** حداکثر ۶ گیرندهٔ اول برای نمایش — بقیه با «+N دیگر» */
  recipients: UserCard[];
}

/** مخاطب ارسال گروهی → شرط پرایسما (همان فیلترهای لیست کاربران) */
const AUDIENCE_WHERE: Record<string, Prisma.UserWhereInput> = {
  all: {},
  active: { isActive: true },
  sellers: { isSeller: true },
  buyers: { isBuyer: true },
  verified: { isVerified: true },
};

/** حجم هر دسته createMany / ارسال پوش — مونگو و event-loop را راحت می‌گذارد */
const CREATE_CHUNK = 500;
/** چند گیرنده آفلاین همزمان اعلان پوش می‌گیرند (پس‌زمینه، بعد از پاسخ) */
const PUSH_BATCH = 50;

/**
 * پیام مستقیم ادمین → کاربر (یک‌طرفه).
 *
 * جریان: ادمین از لیست کاربران (تکی/چندتایی/همه) یا صفحه جزئیات کاربر
 * پیام می‌فرستد → برای هر گیرنده یک ردیف AdminMessage ساخته می‌شود
 * (خوانده‌شدن per-user دقیق می‌ماند) → رویداد WS chat:adminMessage به
 * گیرنده آنلاین و وب‌پوش به گیرنده آفلاین می‌رسد. کاربر پیام را در
 * مکالمه سنجاق‌شده «پشتیبانی ایمچ» (/panel/messages) می‌بیند.
 */
@Injectable()
export class AdminMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  // ─── ارسال ────────────────────────────────────────────────────────────────

  /** POST /admin/messages/sendToUser — یک کاربر (از صفحه جزئیات یا ردیف لیست) */
  async sendToUser(adminUsername: string, dto: SendToUserDto): Promise<{ sent: number }> {
    if (!OID_RE.test(dto.userId)) throw AppError.notFound('کاربر یافت نشد.');
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true },
    });
    if (!user) throw AppError.notFound('کاربر یافت نشد.');

    const message = await this.prisma.adminMessage.create({
      data: {
        userId: user.id,
        adminUsername,
        text: dto.text.trim(),
        batchId: randomUUID(),
        readAt: null,
      },
    });

    this.notifyOne({
      userId: user.id,
      message: { id: message.id, text: message.text, adminUsername, createdAt: message.createdAt },
    });

    return { sent: 1 };
  }

  /** POST /admin/messages/sendToUsers — چند کاربر انتخابی (چک‌باکس لیست) */
  async sendToUsers(adminUsername: string, dto: SendToUsersDto): Promise<{ sent: number; skipped: number }> {
    // شناسه‌های تکراری حذف — ارسال idempotent (نامعتبرها در skipped شمرده می‌شوند)
    const uniqueIds = [...new Set(dto.userIds)];
    const validIds = uniqueIds.filter((id) => OID_RE.test(id));
    if (!validIds.length) throw AppError.badRequest('شناسه کاربران معتبر نیست.');

    const users = await this.prisma.user.findMany({
      where: { id: { in: validIds } },
      select: { id: true },
    });
    if (!users.length) throw AppError.notFound('کاربری یافت نشد.');

    const batchId = randomUUID();
    await this.insertChunks(
      users.map((u) => ({ userId: u.id, adminUsername, text: dto.text.trim(), batchId, readAt: null })),
    );

    // اطلاع‌رسانی پس‌زمینه — پاسخ HTTP منتظر پوش نمی‌ماند
    void this.notifyAll(
      users.map((u) => ({
        userId: u.id,
        message: {
          id: '',
          text: dto.text.trim(),
          adminUsername,
          createdAt: new Date(),
        },
      })),
    );

    return { sent: users.length, skipped: uniqueIds.length - users.length };
  }

  /** POST /admin/messages/sendToAll — همه کاربران (یا مخاطب انتخابی) */
  async sendToAll(adminUsername: string, dto: SendToAllDto): Promise<{ sent: number; audience: string }> {
    const audience = dto.audience ?? 'all';
    const where = AUDIENCE_WHERE[audience] ?? {};

    const users = await this.prisma.user.findMany({ where, select: { id: true } });
    if (!users.length) {
      return { sent: 0, audience };
    }

    const batchId = randomUUID();
    await this.insertChunks(
      users.map((u) => ({ userId: u.id, adminUsername, text: dto.text.trim(), batchId, readAt: null })),
    );

    void this.notifyAll(
      users.map((u) => ({
        userId: u.id,
        message: { id: '', text: dto.text.trim(), adminUsername, createdAt: new Date() },
      })),
    );

    return { sent: users.length, audience };
  }

  // ─── تاریخچه (صفحه جزئیات کاربر) ─────────────────────────────────────────

  /** POST /admin/messages/getUserMessages — جدیدترین اول + شمارنده خوانده‌نشده */
  async getUserMessages(dto: GetUserMessagesDto) {
    if (!OID_RE.test(dto.userId)) throw AppError.notFound('کاربر یافت نشد.');

    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));

    const [total, unread, rows] = await Promise.all([
      this.prisma.adminMessage.count({ where: { userId: dto.userId } }),
      this.prisma.adminMessage.count({ where: { userId: dto.userId, readAt: null } }),
      this.prisma.adminMessage.findMany({
        where: { userId: dto.userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    return {
      total,
      unread,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      items: rows.map((m) => this.toRow(m)),
    };
  }

  // ─── آخرین ارسال‌ها (صفحهٔ «پیام به کاربران») ──────────────────────────

  /**
   * POST /admin/messages/getRecentSends — دسته‌های ارسال اخیر، جدیدترین اول.
   * هر ارسال (تکی/چندتایی/گروهی) یک batchId دارد؛ ردیف‌های قدیمی بدون
   * batchId هرکدام دستهٔ تک‌نفرهٔ خودشان می‌شوند.
   */
  async getRecentSends(): Promise<{ items: AdminSendBatch[] }> {
    const rows = await this.prisma.adminMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 1000,
      include: { user: { select: USER_SELECT } },
    });

    const byBatch = new Map<string, AdminSendBatch>();
    const seenUsers = new Map<string, Set<string>>(); // جلوگیری از تکرار گیرنده در دسته
    for (const m of rows) {
      const key = m.batchId ?? `solo:${m.id}`;
      let batch = byBatch.get(key);
      if (!batch) {
        batch = {
          batchId: key,
          text: m.text,
          adminUsername: m.adminUsername,
          at: m.createdAt,
          total: 0,
          read: 0,
          recipients: [],
        };
        byBatch.set(key, batch);
        seenUsers.set(key, new Set());
      }
      batch.total += 1;
      if (m.readAt) batch.read += 1;
      const seen = seenUsers.get(key)!;
      if (!seen.has(m.userId) && batch.recipients.length < 6) {
        seen.add(m.userId);
        batch.recipients.push(toUserCard(m.user));
      }
    }

    return { items: [...byBatch.values()].slice(0, 30) };
  }

  // ─── داخلی ─────────────────────────────────────────────────────────────────

  /** createMany قطعه‌قطعه — مونگو در یک insert چند هزار ردیف را دوست ندارد */
  private async insertChunks(
    data: Array<{ userId: string; adminUsername: string; text: string; batchId: string; readAt: null }>,
  ): Promise<void> {
    for (let i = 0; i < data.length; i += CREATE_CHUNK) {
      await this.prisma.adminMessage.createMany({ data: data.slice(i, i + CREATE_CHUNK) });
    }
  }

  /** اطلاع‌رسانی یک گیرنده — WS آنلاین / وب‌پوش آفلاین (آتش‌وفراموش) */
  private notifyOne(payload: {
    userId: string;
    message: { id: string; text: string; adminUsername: string; createdAt: Date };
  }): void {
    emitToUser(payload.userId, CHAT_EVENTS.ADMIN_MESSAGE, { message: payload.message });
    if (!isUserOnline(payload.userId)) {
      void this.push
        .sendToUser(payload.userId, {
          title: 'پیام جدید از پشتیبانی ایمچ',
          body: this.preview(payload.message.text),
          url: '/panel/messages',
        })
        .catch(() => undefined);
    }
  }

  /** اطلاع‌رسانی گروهی — WS آنلاین‌ها + پوش آفلاین‌ها در دسته‌های ۵۰تایی */
  private async notifyAll(
    payloads: Array<{ userId: string; message: { id: string; text: string; adminUsername: string } }>,
  ): Promise<void> {
    try {
      for (let i = 0; i < payloads.length; i += PUSH_BATCH) {
        const batch = payloads.slice(i, i + PUSH_BATCH);
        for (const p of batch) {
          emitToUser(p.userId, CHAT_EVENTS.ADMIN_MESSAGE, { message: p.message });
          if (!isUserOnline(p.userId)) {
            await this.push
              .sendToUser(p.userId, {
                title: 'پیام جدید از پشتیبانی ایمچ',
                body: this.preview(p.message.text),
                url: '/panel/messages',
              })
              .catch(() => undefined);
          }
        }
        // نفس‌گیری بین دسته‌ها — event-loop قفل نمی‌شود
        await new Promise((r) => setTimeout(r, 50));
      }
    } catch {
      /* اطلاع‌رسانی هرگز نباید خطا بدهد — ردیف‌ها ساخته شده‌اند */
    }
  }

  /** پیش‌نمایش کوتاه برای اعلان پوش — عین چت (۹۰ نویسه) */
  private preview(text: string): string {
    const t = text.trim();
    return t.length > 90 ? `${t.slice(0, 90)}…` : t;
  }

  private toRow(m: {
    id: string;
    userId: string;
    adminUsername: string;
    text: string;
    readAt: Date | null;
    createdAt: Date;
  }): AdminMessageRow {
    return {
      id: m.id,
      user_id: m.userId,
      admin_username: m.adminUsername,
      text: m.text,
      read_at: m.readAt,
      created_at: m.createdAt,
    };
  }
}
