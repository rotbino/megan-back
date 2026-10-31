import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { AppError } from '../common/errors/app-error';
import type { AuthUser } from '../common/guards';
import { CategoriesService } from '../categories/categories.service';
import { SiteSettingsService } from '../site-settings/site-settings.service';
import { offerDailyLimit } from '../site-settings/billing';
import { effectivePakageType } from '../packages/packages.service';
import { PushService } from '../push/push.service';
import { CHAT_EVENTS, emitToUser, isUserOnline } from '../chat/io-holder';
import {
  BUYER_BOOK_MAX,
  BUYER_UNITS,
  BuyerBookItemDto,
  GetBuyerDirectoryDto,
  GroupSendSupplyOfferDto,
  SaveMyBookDto,
  SendSupplyOfferDto,
} from './dto';

/**
 * ─── خریداران ایمچ (خواسته مالک ۳۱-۱۰) ───────────────────────────────────────
 *
 * «خریدار» = کاربری که در «دفتر خرید من» دسته‌های برگ + بازهٔ حجم خرید ماهانه
 * ثبت کرده است. دایرکتوری عمومی فقط نقش/دسته‌ها/استان‌وشهر/بازهٔ حجم/فعالیت
 * را نشان می‌دهد — نه نام و نه تماس (حریم خصوصی؛ دفتر خرید ربطی به تبلیغات
 * ندارد و آگهی‌ها را ترویج نمی‌کند).
 *
 * تنها راه تماس با خریداران: «پیشنهاد تامین» توسط فروشندهٔ دارندهٔ بستهٔ
 * فعال — روزانه تا سقف سطح بسته (از تنظیمات پویا). تحویل به‌صورت پیام چت
 * در گفتگوی مستقیم است تا خریدار در «پیام ها» ببیند. «ارسال گروهی» پولی
 * است: هر گیرنده از کیف پول فروشنده کسر می‌شود.
 */

const OID_RE = /^[0-9a-fA-F]{24}$/;

/** پنجرهٔ فعال بودن دایرکتوری — خریدار خاموشِ بیش از ۹۰ روز حذف می‌شود */
const ACTIVE_WINDOW_MS = 90 * 86_400_000;
/** نشان «فعال در ۷ روز اخیر» */
const RECENT_WINDOW_MS = 7 * 86_400_000;

/** شروع شبانه‌روز به وقت تهران — سهمیه‌ها روزانه و مرز روز ایرانی است */
function startOfTehranDay(): Date {
  const now = new Date();
  const tehran = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tehran' }));
  const midnight = new Date(tehran.getFullYear(), tehran.getMonth(), tehran.getDate());
  const offset = now.getTime() - tehran.getTime();
  return new Date(midnight.getTime() - offset);
}

/** نقش نمایشی از حجم خرید — تن یا ≥۱ تن کیلو = عمده */
function buyerRole(
  unit: string,
  volumeMin: number,
  volumeMax: number,
): 'عمده‌خریدار' | 'خرده‌خریدار' {
  if (unit === 'تن') return 'عمده‌خریدار';
  if (unit === 'کیلوگرم' && Math.max(volumeMin, volumeMax) >= 1000) return 'عمده‌خریدار';
  if ((unit === 'عدد' || unit === 'بسته' || unit === 'متر' || unit === 'لیتر') && Math.max(volumeMin, volumeMax) >= 5000) {
    return 'عمده‌خریدار';
  }
  return 'خرده‌خریدار';
}

/** ردیف دستهٔ دایرکتوری — نام + بازهٔ حجم خوانا */
interface DirectoryCategory {
  id: number;
  name: string;
  /** «۱ تا ۵ تن در ماه» — بازه، نه عدد دقیق (حریم خصوصی) */
  range: string;
}

export interface BuyerDirectoryItem {
  /** ObjectId خریدار — برای sendSupplyOffer؛ نام/تماس هرگز افشا نمی‌شود */
  id: string;
  role: string;
  categories: DirectoryCategory[];
  moreCategories: number;
  province: string | null;
  city: string | null;
  lastActiveAt: Date;
  activeRecently: boolean;
}

@Injectable()
export class BuyersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly settings: SiteSettingsService,
    private readonly push: PushService,
  ) {}

  // ─── دفتر خرید من ──────────────────────────────────────────────────────────

  /** POST /buyers/getMyBook — ردیف‌های دفتر خرید من با نام دسته */
  async getMyBook(userId: string) {
    const rows = await this.prisma.buyerCategory.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    const cats = await this.categoriesById(rows.map((r) => r.categoryId));
    return {
      max: BUYER_BOOK_MAX,
      units: BUYER_UNITS,
      items: rows.map((r) => ({
        categoryId: r.categoryId,
        name: cats.get(r.categoryId)?.categoryName ?? `دسته ${r.categoryId}`,
        volumeMin: r.volumeMin,
        volumeMax: r.volumeMax,
        unit: r.unit,
      })),
    };
  }

  /** POST /buyers/saveMyBook — جایگزینی کامل (فرم فوق‌ساده: چیپ + بازه) */
  async saveMyBook(userId: string, dto: SaveMyBookDto) {
    const items = dto.items ?? [];
    if (items.length > BUYER_BOOK_MAX) {
      throw AppError.badRequest(`حداکثر ${BUYER_BOOK_MAX} دسته در دفتر خرید 가능 است.`, 'BOOK_MAX');
    }
    // یکتایی دسته‌ها
    const seen = new Set<number>();
    for (const it of items) {
      if (seen.has(it.categoryId)) {
        throw AppError.badRequest('هر دسته فقط یک‌بار قابل انتخاب است.', 'DUPLICATE_CATEGORY');
      }
      seen.add(it.categoryId);
      if (it.volumeMax !== 0 && it.volumeMax < it.volumeMin) {
        throw AppError.badRequest(
          'حداکثر حجم خرید باید بیشتر از حداقل باشد (یا صفر = بدون سقف).',
          'VOLUME_RANGE',
        );
      }
    }
    // فقط دستهٔ برگ (بدون فرزند) — دفتر خرید کالای مشخص است نه شاخه
    if (items.length > 0) {
      const childCount = await this.prisma.category.count({
        where: { parentId: { in: [...seen] } },
      });
      if (childCount > 0) {
        throw AppError.badRequest(
          'فقط دسته‌های پایانی (بدون زیر‌دسته) قابل انتخاب هستند.',
          'NOT_LEAF',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.buyerCategory.deleteMany({ where: { userId } }),
      ...items.map((it: BuyerBookItemDto) =>
        this.prisma.buyerCategory.create({
          data: {
            userId,
            categoryId: it.categoryId,
            volumeMin: it.volumeMin,
            volumeMax: it.volumeMax,
            unit: it.unit,
          },
        }),
      ),
    ]);

    return { saved: items.length };
  }

  // ─── دایرکتوری عمومی ────────────────────────────────────────────────────────

  /** POST /buyers/directory — فیلتر مثل لیست آگهی‌ها: دسته/استان/شهر + صفحه.
   *  حریم خصوصی: فقط نقش/دسته‌ها/مکان/بازهٔ حجم/فعالیت — بی نام و تماس. */
  async directory(dto: GetBuyerDirectoryDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(48, Math.max(1, dto.perPage ?? 12));

    // مجموعهٔ دسته‌های زیر دستهٔ انتخابی (خودش + زیر‌شاخه‌ها) — ردیف‌های دفتر
    // خرید و درخواست‌ها همیشه برگ‌اند؛ فیلتر درختی درست درمی‌آید
    const leafSet = dto.categoryId
      ? new Set(await this.categories.getSubtreeIds(dto.categoryId))
      : null;

    // ردیف‌های دفتر خرید در این دسته‌ها → گروه‌بندی بر کاربر
    // (سقف اطمینان ۵۰۰۰ ردیف — دایرکتوری سبک می‌ماند)
    const rows = await this.prisma.buyerCategory.findMany({
      where: leafSet ? { categoryId: { in: [...leafSet] } } : undefined,
      select: { userId: true, categoryId: true, volumeMin: true, volumeMax: true, unit: true },
      take: 5000,
    });

    const byUser = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byUser.get(r.userId) ?? [];
      list.push(r);
      byUser.set(r.userId, list);
    }

    // کاربران فعالِ اخیر + فیلتر مکان
    // ⚠️ مونگو: فیلتر null فیلدِ غایب را نمی‌گیرد → پنجرهٔ فعالیت =
    // lastSeenAt (هست) یا createdAt (هیچ‌وقت نبض نزده) — چون lastSeenAt
    // همیشه ≥ createdAt است، این دقیقاً max(هر دو) است.
    const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);
    const users = byUser.size
      ? await this.prisma.user.findMany({
          where: {
            id: { in: [...byUser.keys()] },
            isActive: true,
            OR: [{ lastSeenAt: { gte: cutoff } }, { createdAt: { gte: cutoff } }],
            ...(dto.provinceId != null ? { provinceId: dto.provinceId } : {}),
            ...(dto.cityId != null ? { cityId: dto.cityId } : {}),
          },
          select: {
            id: true,
            provinceId: true,
            cityId: true,
            lastSeenAt: true,
            createdAt: true,
          },
        })
      : [];

    // نام دسته‌ها + مکان‌ها — یک‌جا
    const catIds = new Set<number>();
    for (const list of byUser.values()) for (const r of list) catIds.add(r.categoryId);
    const [cats, locations] = await Promise.all([
      this.categoriesById([...catIds]),
      this.locationNames(
        users.flatMap((u) => [u.provinceId, u.cityId].filter((x): x is number => x != null)),
      ),
    ]);

    // کارت‌ها — فعال‌ترها اول
    const now = Date.now();
    const items: BuyerDirectoryItem[] = users.map((u) => {
      const list = (byUser.get(u.id) ?? []).slice(0, 3);
      const role = (byUser.get(u.id) ?? []).some((r) =>
        buyerRole(r.unit, r.volumeMin, r.volumeMax) === 'عمده‌خریدار',
      )
        ? 'عمده‌خریدار'
        : 'خرده‌خریدار';
      const last = u.lastSeenAt ?? u.createdAt;
      return {
        id: u.id,
        role,
        categories: list.map((r) => ({
          id: r.categoryId,
          name: cats.get(r.categoryId)?.categoryName ?? `دسته ${r.categoryId}`,
          range: volumeRangeFa(r.volumeMin, r.volumeMax, r.unit),
        })),
        moreCategories: Math.max(0, (byUser.get(u.id) ?? []).length - 3),
        province: u.provinceId != null ? (locations.get(`p${u.provinceId}`) ?? null) : null,
        city: u.cityId != null ? (locations.get(`c${u.cityId}`) ?? null) : null,
        lastActiveAt: last,
        activeRecently: now - last.getTime() < RECENT_WINDOW_MS,
      };
    });
    items.sort((a, b) => {
      if (a.activeRecently !== b.activeRecently) return a.activeRecently ? -1 : 1;
      return b.lastActiveAt.getTime() - a.lastActiveAt.getTime();
    });

    // درخواست‌های خرید همین دسته — تصمیم نمایش تب دوم
    let buyRequestCount: number | null = null;
    if (leafSet && leafSet.size > 0) {
      buyRequestCount = await this.prisma.buyRequest.count({
        where: { categoryId: { in: [...leafSet] }, status: 'confirmed' },
      });
    }

    const total = items.length;
    return {
      items: items.slice((page - 1) * perPage, page * perPage),
      total,
      page,
      perPage,
      buyRequestCount,
    };
  }

  // ─── سهمیه و پیشنهاد تامین ─────────────────────────────────────────────────

  /** POST /buyers/getMyOfferQuota — وضعیت سهمیه برای UI دکمه/مودال */
  async myQuota(user: AuthUser) {
    const billing = await this.settings.getBilling();
    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { activePakageType: true, packageExpiresAt: true, walletBalance: true },
    });
    const active = me ? effectivePakageType(me.activePakageType, me.packageExpiresAt) : 0;
    const limit = offerDailyLimit(billing, active);
    const [usedToday, groupUsedToday] = await Promise.all([
      this.distinctBuyersToday(user.id),
      this.groupRecipientsToday(user.id),
    ]);
    return {
      isFeatured: active > 0,
      pakageType: active,
      dailyLimit: active > 0 ? limit : 0,
      usedToday,
      left: active > 0 ? Math.max(0, limit - usedToday) : 0,
      groupSend: {
        perRecipientPrice: billing.groupSend.perRecipientPrice,
        maxBatch: billing.groupSend.maxBatch,
        maxPerDay: billing.groupSend.maxPerDay,
        usedToday: groupUsedToday,
        left: Math.max(0, billing.groupSend.maxPerDay - groupUsedToday),
      },
      walletBalance: me?.walletBalance ?? 0,
    };
  }

  /** POST /buyers/sendSupplyOffer — تکی، رایگان تا سقف روزانهٔ سطح بسته */
  async sendSupplyOffer(user: AuthUser, dto: SendSupplyOfferDto) {
    const gates = await this.offerGates(user, 1);
    const message = dto.message.trim();

    // خریدار هدف — باید دفتر خرید پر داشته باشد و فعال باشد
    const target = await this.prisma.user.findUnique({
      where: { id: dto.buyerId },
      select: { id: true, isActive: true },
    });
    if (!target || !target.isActive || target.id === user.id) {
      throw AppError.notFound('خریدار یافت نشد.');
    }
    const targetBook = await this.prisma.buyerCategory.count({ where: { userId: target.id } });
    if (targetBook === 0) {
      throw AppError.notFound('خریدار یافت نشد.');
    }

    // سهمیهٔ خریدارانِ متمایز امروز — تکرار به همان خریدار سهمیه نمی‌گیرد
    const contacted = await this.contactedBuyerIdsToday(user.id);
    if (!contacted.has(target.id) && gates.usedToday >= gates.limit) {
      throw AppError.badRequest(
        `سهمیهٔ پیشنهاد تامین امروز شما پر شده است (${gates.limit} خریدار در شبانه‌روز). برای ظرفیت بیشتر، بستهٔ بالاتر تهیه کنید یا از «ارسال گروهی» استفاده کنید.`,
        'OFFER_LIMIT_REACHED',
      );
    }

    const offer = await this.prisma.supplyOffer.create({
      data: { sellerId: user.id, buyerId: target.id, message, isGroup: false, fee: 0 },
    });
    const threadId = await this.deliverOfferMessage(user.id, target.id, message);

    const left = Math.max(0, gates.limit - gates.usedToday - (contacted.has(target.id) ? 0 : 1));
    return { offerId: offer.id, threadId, quotaLeft: left };
  }

  /** POST /buyers/groupSendSupplyOffer — گروهی، پولی از کیف پول (اتمیک) */
  async groupSendSupplyOffer(user: AuthUser, dto: GroupSendSupplyOfferDto) {
    const billing = await this.settings.getBilling();
    const ids = [...new Set(dto.buyerIds)];
    const gates = await this.offerGates(user, ids.length);
    const message = dto.message.trim();

    if (ids.length > billing.groupSend.maxBatch) {
      throw AppError.badRequest(
        `هر ارسال گروهی حداکثر ${billing.groupSend.maxBatch} گیرنده دارد.`,
        'GROUP_BATCH_MAX',
      );
    }
    if (gates.groupUsedToday + ids.length > billing.groupSend.maxPerDay) {
      throw AppError.badRequest(
        `سقف ارسال گروهی امروز پر شده است (${billing.groupSend.maxPerDay} گیرنده در شبانه‌روز).`,
        'GROUP_DAY_MAX',
      );
    }

    // اهداف — فعال + دفتر خرید پر
    const targets = await this.prisma.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true },
    });
    const books = await this.prisma.buyerCategory.groupBy({ by: ['userId'] }).then((g) =>
      new Set(g.map((x) => x.userId)),
    );
    const valid = targets.filter((t) => t.id !== user.id && books.has(t.id));
    if (valid.length === 0) {
      throw AppError.badRequest('خریدار معتبری برای ارسال انتخاب نشده است.', 'NO_VALID_BUYER');
    }

    const fee = valid.length * billing.groupSend.perRecipientPrice;
    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { walletBalance: true },
    });
    if (!me || me.walletBalance < fee) {
      throw AppError.badRequest(
        `موجودی کیف پول برای ارسال گروهی به ${valid.length} خریدار کافی نیست — ${fee.toLocaleString('fa-IR')} تومان لازم دارید.`,
        'WALLET_INSUFFICIENT',
      );
    }

    // کسر اتمیک + ردیف‌های پیشنهاد — گارد شرطی موجودی (P2025 → کافی نیست)
    let balance = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: user.id, walletBalance: { gte: fee } },
          data: { walletBalance: { decrement: fee } },
        });
        balance = updated.walletBalance;
        await tx.supplyOffer.createMany({
          data: valid.map((t) => ({
            sellerId: user.id,
            buyerId: t.id,
            message,
            isGroup: true,
            fee: billing.groupSend.perRecipientPrice,
          })),
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw AppError.badRequest(
          'موجودی کیف پول برای این ارسال گروهی کافی نیست — ابتدا کیف پول را شارژ کنید.',
          'WALLET_INSUFFICIENT',
        );
      }
      throw err;
    }

    // تحویل پیام چت — پس از تراکنش؛ بهترین‌حالتی (خطای یکی مانع بقیه نمی‌شود)
    for (const t of valid) {
      await this.deliverOfferMessage(user.id, t.id, message).catch(() => undefined);
    }

    return {
      sent: valid.length,
      fee,
      perRecipient: billing.groupSend.perRecipientPrice,
      balance,
      groupLeft: Math.max(0, billing.groupSend.maxPerDay - gates.groupUsedToday - valid.length),
    };
  }

  // ─── خصوصی ─────────────────────────────────────────────────────────────────

  /** گیت‌های مشترک پیشنهاد تامین — بستهٔ فعال + سهمیه‌ها */
  private async offerGates(user: AuthUser, batch: number) {
    const billing = await this.settings.getBilling();
    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { activePakageType: true, packageExpiresAt: true, isActive: true },
    });
    if (!me || !me.isActive) throw AppError.forbidden('حساب شما در دسترس نیست.');
    const active = effectivePakageType(me.activePakageType, me.packageExpiresAt);
    if (active <= 0) {
      throw AppError.forbidden(
        'ارسال پیشنهاد تامین مخصوص فروشندگان دارندهٔ بستهٔ اشتراک فعال است.',
        'PACKAGE_REQUIRED',
      );
    }
    const [usedToday, groupUsedToday] = await Promise.all([
      this.distinctBuyersToday(user.id),
      this.groupRecipientsToday(user.id),
    ]);
    return {
      billing,
      active,
      limit: offerDailyLimit(billing, active),
      usedToday,
      groupUsedToday,
      batch,
    };
  }

  /** شمار خریداران متمایزِ امروز (ارسال تکی) */
  private async distinctBuyersToday(sellerId: string): Promise<number> {
    const ids = await this.contactedBuyerIdsToday(sellerId);
    return ids.size;
  }

  private async contactedBuyerIdsToday(sellerId: string): Promise<Set<string>> {
    const rows = await this.prisma.supplyOffer.findMany({
      where: { sellerId, isGroup: false, createdAt: { gte: startOfTehranDay() } },
      select: { buyerId: true },
    });
    return new Set(rows.map((r) => r.buyerId));
  }

  /** شمار گیرندگان گروهی امروز */
  private async groupRecipientsToday(sellerId: string): Promise<number> {
    return this.prisma.supplyOffer.count({
      where: { sellerId, isGroup: true, createdAt: { gte: startOfTehranDay() } },
    });
  }

  /** تحویل پیشنهاد به‌صورت پیام چت در گفتگوی مستقیم + push/WS */
  private async deliverOfferMessage(sellerId: string, buyerId: string, text: string): Promise<string> {
    // نام نمایشی فروشنده — برای عنوان پیام/اعلان خریدار
    const seller = await this.prisma.user.findUnique({
      where: { id: sellerId },
      select: { firstName: true, lastName: true },
    });
    // گفتگوی مستقیم فروشنده↔خریدار (بدون آگهی زمینه) — upsert با بازیابی P2002
    let thread = await this.prisma.chatThread.findFirst({
      where: { sellerId, buyerId, productId: null },
    });
    if (!thread) {
      try {
        thread = await this.prisma.chatThread.create({
          data: { productId: null, sellerId, buyerId },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          thread = await this.prisma.chatThread.findFirstOrThrow({
            where: { sellerId, buyerId, productId: null },
          });
        } else {
          throw e;
        }
      }
    }

    const message = await this.prisma.chatMessage.create({
      data: { threadId: thread.id, senderId: sellerId, text, readAt: null },
    });
    await this.prisma.chatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: message.createdAt },
    });

    // push زنده + اعلان وب‌پوش برای آفلاین‌ها — هرگز جریان اصلی را نمی‌شکنند
    const senderName =
      `${seller?.firstName ?? ''} ${seller?.lastName ?? ''}`.trim() || 'فروشنده ایمچ';
    emitToUser(buyerId, CHAT_EVENTS.NEW_MESSAGE, {
      threadId: thread.id,
      message: { id: message.id, threadId: thread.id, senderId: sellerId, text, readAt: null, createdAt: message.createdAt },
      senderName,
      productName: undefined,
    });
    if (!isUserOnline(buyerId)) {
      void this.push
        .sendToUser(buyerId, {
          title: `پیشنهاد تامین از ${senderName}`,
          body: text.length > 90 ? `${text.slice(0, 90)}…` : text,
          url: '/panel/messages',
        })
        .catch(() => undefined);
    }
    return thread.id;
  }

  /** تحویل پیشنهاد به‌صورت پیام چت در گفتگوی مستقیم + push/WS */

  /** نام دسته‌ها بر اساس id — یک کوئری */
  private async categoriesById(ids: number[]) {
    if (ids.length === 0) return new Map<number, { categoryName: string }>();
    const rows = await this.prisma.category.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, categoryName: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** نام استان/شهر — پیشوند p (استان) و c (شهر) برای تفکیک buskolId */
  private async locationNames(ids: number[]) {
    if (ids.length === 0) return new Map<string, string>();
    const uniq = [...new Set(ids)];
    const rows = await this.prisma.location.findMany({
      where: { buskolId: { in: uniq }, type: { in: ['province', 'city'] } },
      select: { type: true, buskolId: true, name: true },
    });
    return new Map(rows.map((r) => [`${r.type === 'province' ? 'p' : 'c'}${r.buskolId}`, r.name]));
  }
}

/** بازهٔ حجم خوانا — «۱ تا ۵ تن در ماه» (عدد دقیق افشا نمی‌شود) */
function volumeRangeFa(min: number, max: number, unit: string): string {
  const fa = (n: number) => n.toLocaleString('fa-IR');
  if (max === 0) return `${fa(min)} ${unit} و بیشتر در ماه`;
  if (min === max) return `${fa(min)} ${unit} در ماه`;
  return `${fa(min)} تا ${fa(max)} ${unit} در ماه`;
}
