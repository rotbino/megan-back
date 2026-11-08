import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import { UploadsService } from '../uploads/uploads.service';
import { buildStorage, type StorageDriver } from '../uploads/storage';
import { validateConversationUpload } from '../common/file-upload/rules';
import type { SendMessageDto } from './dto';

/** پیام گفتگوی پشتیبانی — شکل مشترک با نمای ادمین (خواسته مالک ۸-۱۱:
 *  پیوست تصویر/ویدئو/سند تا ۵MB، قرینهٔ ChatMessage) */
export interface SupportMessageDto {
  id: string;
  /** user | admin — فرستنده */
  senderRole: 'user' | 'admin';
  /** نام ادمین پاسخ‌دهنده — فقط پیام‌های ادمین */
  adminUsername: string | null;
  /** متن یا کپشن — با پیوست می‌تواند خالی باشد */
  text: string;
  /** نوع پیام — text | image | video | file */
  kind: 'text' | 'image' | 'video' | 'file';
  /** فایل پیوست — null برای پیام متنی */
  file: {
    url: string;
    /** کلید ذخیره‌سازی — فقط داخلی */
    key: string;
    name: string;
    size: number;
    mime: string;
  } | null;
  /** null = گیرنده هنوز نخوانده */
  readAt: Date | null;
  createdAt: Date;
}

/** فیلدهای فایل مشترک بین دو سرویس — پرایسما ردیف → DTO */
export function toSupportDto(m: {
  id: string;
  senderRole: string;
  adminUsername: string | null;
  text: string;
  kind: string | null;
  fileUrl: string | null;
  fileKey: string | null;
  fileName: string | null;
  fileSize: number | null;
  fileMime: string | null;
  readAt: Date | null;
  createdAt: Date;
}): SupportMessageDto {
  const kind = (['image', 'video', 'file'] as const).includes(m.kind as never)
    ? (m.kind as 'image' | 'video' | 'file')
    : 'text';
  return {
    id: m.id,
    senderRole: m.senderRole === 'admin' ? 'admin' : 'user',
    adminUsername: m.adminUsername,
    text: m.text,
    kind,
    file:
      kind !== 'text' && m.fileUrl
        ? {
            url: m.fileUrl,
            key: m.fileKey ?? '',
            name: m.fileName ?? 'فایل',
            size: m.fileSize ?? 0,
            mime: m.fileMime ?? 'application/octet-stream',
          }
        : null,
    readAt: m.readAt,
    createdAt: m.createdAt,
  };
}

/** select مشترک پرایسما — همهٔ فیلدهای DTO */
export const SUPPORT_MESSAGE_SELECT = {
  id: true,
  senderRole: true,
  adminUsername: true,
  text: true,
  kind: true,
  fileUrl: true,
  fileKey: true,
  fileName: true,
  fileSize: true,
  fileMime: true,
  readAt: true,
  createdAt: true,
} as const;

/**
 * گفتگوی پشتیبانی کاربر ↔ پشتیبان — دوطرفه (خواستهٔ مالک ۸-۱۱ دور ۲۱).
 *
 * سمت کاربر (/panel/support — کارت «گفتگو با پشتیبان»):
 *  • getConversation — کل گفتگو (قدیمی→جدید) + علامت‌خوردن پیام‌های
 *    پشتیبان به‌عنوان خوانده‌شده (خواندن واقعی توسط خود کاربر)
 *  • sendMessage — پیام جدید کاربر به پشتیبان (متن یا فایل + کپشن)
 *  • uploadFile — پیوست تصویر/ویدئو/سند تا ۵MB (قواعد مشترک چت)
 *
 * پاسخ‌دهی در ماژول admin-support انجام می‌شود (پنل مدیریت → پشتیبانی).
 */
@Injectable()
export class SupportService {
  private readonly storage: StorageDriver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {
    this.storage = buildStorage();
  }

  /** کل گفتگوی پشتیبانی کاربر — خواندن فقط با فراخوانی صریح markRead
   *  (رفع باگ ۸-۱۱ دور ۲۴: قبلاً هر fetch (polling پس‌زمینه/تب مخفی) بج
   *  پشتیبانی را بی‌آنکه کاربر ببیند صفر می‌کرد — حلقهٔ اعلان می‌شکست) */
  async getConversation(userId: string, markRead = false) {
    // اول شمار پاسخ‌های خوانده‌نشده پشتیبان (برای toast/بج فرانت)
    const unreadFromAdmin = await this.prisma.supportMessage.count({
      where: { userId, senderRole: 'admin', readAt: null },
    });

    // فقط با فراخوانی صریح (تب مرئی + کاربر واقعاً صفحه را می‌بیند)
    if (markRead && unreadFromAdmin > 0) {
      await this.prisma.supportMessage.updateMany({
        where: { userId, senderRole: 'admin', readAt: null },
        data: { readAt: new Date() },
      });
    }

    const messages = await this.prisma.supportMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: SUPPORT_MESSAGE_SELECT,
      take: 200,
    });

    return { messages: messages.map(toSupportDto), unreadFromAdmin };
  }

  /** POST /support/markRead — باز کردن واقعی صفحهٔ پشتیبانی = خواندن
   *  پاسخ‌های پشتیبان؛ بج‌ها (ticket) صفر می‌شوند. */
  async markRead(userId: string): Promise<{ read: number }> {
    const r = await this.prisma.supportMessage.updateMany({
      where: { userId, senderRole: 'admin', readAt: null },
      data: { readAt: new Date() },
    });
    return { read: r.count };
  }

  /**
   * POST /support/uploadFile — پیوست گفتگوی پشتیبانی (multipart، سقف ۵MB،
   * لیست سفید مشترک با چت). بایت‌ها زیر support/<userId>/ ذخیره می‌شوند
   * تا مالکیت فایل در sendMessage قابل اثبات باشد.
   */
  async uploadFile(userId: string, req: FastifyRequest): Promise<{
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
    const key = `support/${userId}/${stamp}-${rand}.${ext}`;
    const url = await this.storage.put(key, buffer, mimetype);

    return { url, key, name: safeName, size: buffer.length, mime: mimetype, kind };
  }

  /** پیام جدید کاربر به پشتیبان — متن، یا فایل + کپشن دلخواه */
  async sendMessage(userId: string, dto: SendMessageDto): Promise<SupportMessageDto> {
    const kind = dto.kind ?? 'text';
    const hasFile = kind !== 'text';
    const text = (dto.text ?? '').trim();

    if (!hasFile && text.length < 5) {
      throw AppError.badRequest('متن پیام باید حداقل ۵ نویسه باشد.', 'SUPPORT_TEXT_SHORT');
    }
    if (hasFile && !dto.fileUrl) {
      throw AppError.badRequest('اطلاعات فایل ناقص است.', 'FILE_META_REQUIRED');
    }
    // مالکیت فایل — کلید باید زیر پوشهٔ خود کاربر باشد (از uploadFile خودش)
    if (hasFile && !dto.fileKey!.startsWith(`support/${userId}/`)) {
      throw AppError.forbidden('این فایل به شما تعلق ندارد.');
    }

    const msg = await this.prisma.supportMessage.create({
      data: {
        userId,
        senderRole: 'user',
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
    return toSupportDto(msg);
  }
}
