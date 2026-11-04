import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import type { AuthUser } from '../common/guards';
import type { ContactInputDto } from './dto';

export interface ContactDto {
  id: string;
  name: string | null;
  /** نرمال‌شده — هم‌شکل User.phone برای اعضای ایرانی */
  phone: string;
  /** عضو ایمچ است؟ (تطبیق لحظه‌ای با User.phone) */
  isMember: boolean;
  /** فقط برای اعضا — برای لینک پروفایل/گفتگو در آینده */
  memberUserName: string | null;
  memberAvatarUrl: string | null;
}

/**
 * ─── مخاطبین گوشی (۴-۱۱) ────────────────────────────────────────────────────
 * «ارسال به مخاطبین» — دکمهٔ فقط-موبایل جعبهٔ اشتراک: مخاطبین گوشی با
 * Contact Picker مرورگر (Android Chrome) یک‌بار خوانده و اینجا ذخیره
 * می‌شوند؛ از آن پس همیشه در ایمچ در دسترس‌اند. اعضا متمایز دیده می‌شوند
 * و بقیه دکمهٔ «دعوت به آیمچ» (پیامک) می‌گیرند.
 */
@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  /** نرمال‌سازی شمارهٔ ایرانی به شکل User.phone (09xxxxxxxxx) — ارقام فارسی،
   *  +98/0098/98 و جداکننده‌ها همه پاک می‌شوند؛ غیرایرانی = ارقام خام */
  static normalizePhone(raw: string): string {
    const fa = '۰۱۲۳۴۵۶۷۸۹';
    let s = (raw ?? '')
      .trim()
      .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
      .replace(/[\s\-().]/g, '');
    if (s.startsWith('+')) s = s.slice(1);
    if (s.startsWith('00')) s = s.slice(2);
    if (/^989\d{9}$/.test(s)) s = `0${s.slice(2)}`;
    if (/^9\d{9}$/.test(s)) s = `0${s}`;
    return s;
  }

  /** POST /contacts/import — upsert دسته‌ای مخاطبین گوشی من */
  async importContacts(user: AuthUser, dto: { items: ContactInputDto[] }): Promise<{ imported: number }> {
    // نرمال + حذف تکراری/خالی — idempotent (بارها «لود یک‌باره» بی‌ضرر است)
    const byPhone = new Map<string, string | null>();
    for (const it of dto.items) {
      const phone = ContactsService.normalizePhone(it.phone);
      if (!/^\d{4,24}$/.test(phone)) continue; // حروف/کوتاه — بی‌صدا رد
      const name = it.name?.trim().slice(0, 80) || null;
      // اولین نام پر مقدار برنده می‌شود (رکوردهای بعدی همان شماره فقط نام خالی را پر می‌کنند)
      if (!byPhone.has(phone) || (!byPhone.get(phone) && name)) byPhone.set(phone, name);
    }
    if (byPhone.size === 0) throw AppError.badRequest('مخاطب معتبری برای ذخیره ارسال نشد.', 'NO_VALID_CONTACTS');

    let imported = 0;
    for (const [phone, name] of byPhone) {
      const existing = await this.prisma.contact.findUnique({
        where: { userId_phone: { userId: user.id, phone } },
        select: { id: true, name: true },
      });
      if (existing) {
        // نام گوشی را به‌روز کن اگر جدید مقدار دارد و قدیمی ندارد
        if (name && !existing.name) {
          await this.prisma.contact.update({ where: { id: existing.id }, data: { name } });
        }
      } else {
        await this.prisma.contact.create({ data: { userId: user.id, phone, name } });
        imported++;
      }
    }
    return { imported };
  }

  /** GET /contacts — لیست مخاطبین من + عضویت لحظه‌ای در ایمچ */
  async getMyContacts(user: AuthUser): Promise<{ items: ContactDto[]; total: number }> {
    const rows = await this.prisma.contact.findMany({
      where: { userId: user.id },
      orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
    if (rows.length === 0) return { items: [], total: 0 };

    // تطبیق عضویت — گروهی روی شماره‌ها
    const members = await this.prisma.user.findMany({
      where: { phone: { in: rows.map((r) => r.phone) } },
      select: { phone: true, userName: true, avatarUrl: true, isActive: true },
    });
    const memberByPhone = new Map(members.filter((m) => m.isActive).map((m) => [m.phone, m]));

    return {
      items: rows.map((r) => {
        const m = memberByPhone.get(r.phone);
        return {
          id: r.id,
          name: r.name,
          phone: r.phone,
          isMember: Boolean(m),
          memberUserName: m?.userName ?? null,
          memberAvatarUrl: m?.avatarUrl ?? null,
        };
      }),
      total: rows.length,
    };
  }

  /** DELETE /contacts/:id — حذف یک مخاطب از لیست من */
  async deleteContact(user: AuthUser, id: string): Promise<{ deleted: true }> {
    const c = await this.prisma.contact.findUnique({ where: { id }, select: { userId: true } });
    if (!c || c.userId !== user.id) throw AppError.notFound('مخاطب یافت نشد.');
    await this.prisma.contact.delete({ where: { id } });
    return { deleted: true };
  }
}
