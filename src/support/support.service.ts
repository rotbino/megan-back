import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';

/** پیام گفتگوی پشتیبانی — شکل مشترک با نمای ادمین */
export interface SupportMessageDto {
  id: string;
  /** user | admin — فرستنده */
  senderRole: 'user' | 'admin';
  /** نام ادمین پاسخ‌دهنده — فقط پیام‌های ادمین */
  adminUsername: string | null;
  text: string;
  /** null = گیرنده هنوز نخوانده */
  readAt: Date | null;
  createdAt: Date;
}

/**
 * گفتگوی پشتیبانی کاربر ↔ پشتیبان — دوطرفه (خواستهٔ مالک ۸-۱۱ دور ۲۱).
 *
 * سمت کاربر (/panel/support — کارت «گفتگو با پشتیبان»):
 *  • getConversation — کل گفتگو (قدیمی→جدید) + علامت‌خوردن پیام‌های
 *    پشتیبان به‌عنوان خوانده‌شده (خواندن واقعی توسط خود کاربر)
 *  • sendMessage — پیام جدید کاربر به پشتیبان
 *
 * پاسخ‌دهی در ماژول admin-support انجام می‌شود (پنل مدیریت → پشتیبانی).
 */
@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  /** کل گفتگوی پشتیبانی کاربر — باز کردن = خواندن پیام‌های پشتیبان */
  async getConversation(userId: string) {
    // اول شمار پاسخ‌های خوانده‌نشده پشتیبان (برای toast/بج فرانت)
    const unreadFromAdmin = await this.prisma.supportMessage.count({
      where: { userId, senderRole: 'admin', readAt: null },
    });

    // باز کردن گفتگو = پیام‌های پشتیبان خوانده‌شده (الگوی AdminMessage)
    if (unreadFromAdmin > 0) {
      await this.prisma.supportMessage.updateMany({
        where: { userId, senderRole: 'admin', readAt: null },
        data: { readAt: new Date() },
      });
    }

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

    return { messages, unreadFromAdmin };
  }

  /** پیام جدید کاربر به پشتیبان */
  async sendMessage(userId: string, text: string): Promise<SupportMessageDto> {
    // readAt: null صریح — در MongoDB کانکتور پرایسما فیلد optional حذف‌شده
    // با فیلتر null مچ نمی‌شود (الگوی chat.service خط ۳۲۸)
    const msg = await this.prisma.supportMessage.create({
      data: { userId, senderRole: 'user', text: text.trim(), readAt: null },
    });
    return {
      id: msg.id,
      senderRole: 'user',
      adminUsername: null,
      text: msg.text,
      readAt: msg.readAt,
      createdAt: msg.createdAt,
    };
  }

  /** شمار پاسخ‌های خوانده‌نشده پشتیبان برای یک کاربر (بج سمت کاربر) */
  async unreadFromAdmin(userId: string): Promise<number> {
    return this.prisma.supportMessage.count({
      where: { userId, senderRole: 'admin', readAt: null },
    });
  }

  /** ولیدیشن وجود کاربر — برای ادمین (userId بیرونی) */
  async assertUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.notFound('کاربر یافت نشد.');
    return user;
  }
}
