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
  BUYER_PERIODS,
  BuyerBookItemDto,
  GetBuyerDirectoryDto,
  GetMyReceivedOffersDto,
  GetMySentOffersDto,
  GroupSendSupplyOfferDto,
  SaveMyBookDto,
  SendSupplyOfferDto,
  SupplyOfferTermsDto,
} from './dto';

/**
 * ─── خریداران ایمچ (خواسته مالک ۳۱-۱۰) ───────────────────────────────────────
 *
 * «خریدار» = کاربری که در «دفتر خرید من» دسته‌های برگ + بازهٔ حجم خرید ماهانه
 * ثبت کرده است. دایرکتوری عمومی نام نمایشی خریدار + دسته‌ها/استان‌وشهر/
 * بازهٔ حجم/دوره/فعالیت را نشان می‌دهد (خواستهٔ مالک ۱-۱۱: نام خریدار روی
 * کارت بیاید) — شمارهٔ تماس هرگز افشا نمی‌شود؛ تماس فقط از مسیر چت است.
 *
 * تنها راه تماس با خریداران: «پیشنهاد تامین» توسط فروشندهٔ دارندهٔ بستهٔ
 * فعال — روزانه تا سقف سطح بسته (از تنظیمات پویا). تحویل به‌صورت پیام چت
 * در گفتگوی مستقیم است تا خریدار در «پیام ها» ببیند. «ارسال گروهی» پولی
 * است: هر گیرنده از کیف پول فروشنده کسر می‌شود.
 */

const OID_RE = /^[0-9a-fA-F]{24}$/;

/** مرز کم‌رنگ‌شدن — خریدار غایبِ بیش از ۹۰ روز «کم‌رنگ» می‌شود (نه حذف) */
const ACTIVE_WINDOW_MS = 90 * 86_400_000;
/** پنجرهٔ کامل دایرکتوری — ردیف‌های قدیمی‌تر از این مدت اصلاً نمی‌آیند */
const STALE_WINDOW_MS = 180 * 86_400_000;
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
function buyerRole(unit: string, volumeMin: number): 'عمده‌خریدار' | 'خرده‌خریدار' {
  if (unit === 'تن') return 'عمده‌خریدار';
  if (unit === 'کیلوگرم' && volumeMin >= 1000) return 'عمده‌خریدار';
  if ((unit === 'عدد' || unit === 'بسته' || unit === 'متر' || unit === 'لیتر') && volumeMin >= 5000) {
    return 'عمده‌خریدار';
  }
  return 'خرده‌خریدار';
}

/** آیتم دایرکتوری — یک کارت برای هر کالای دفتر خرید (مرور آیتم‌محور) */
export interface BuyerDirectoryEntry {
  /** ObjectId ردیف — برای انتخاب گروهی */
  id: string;
  /** ObjectId خریدار — برای sendSupplyOffer */
  buyerId: string;
  /** نام نمایشی خریدار — «علی مرادی» (خواستهٔ مالک ۱-۱۱) */
  buyerName: string;
  role: string;
  categoryId: number;
  categoryName: string;
  /** نام دستهٔ ریشه — برای آیکون کارت */
  rootName: string;
  /** مسیر دسته — «کشاورزی / میوه» */
  categoryPath: string;
  unit: string;
  minAmount: number;
  period: string;
  province: string | null;
  city: string | null;
  lastActiveAt: Date;
  activeRecently: boolean;
  /** غایب بیش از ۹۰ روز — در UI کم‌رنگ و انتهای فهرست */
  stale: boolean;
}

/** شرایط ساختاریافتهٔ تامین — خروجی normalizeTerms (آمادهٔ spread در create) */
type OfferTerms = {
  categoryId?: number;
  productType?: string;
  checkAccepted: boolean;
  checkPercent?: number;
  checkMaxDays?: number;
  deliveryToBuyer: boolean;
  shippingCostBy?: string;
  minOrderAmount?: number;
};

@Injectable()
export class BuyersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly settings: SiteSettingsService,
    private readonly push: PushService,
  ) {}

  // ─── دفتر خرید من ──────────────────────────────────────────────────────────

  /** POST /buyers/getMyBook — ردیف‌های دفتر خرید من با نام دسته و مسیر */
  async getMyBook(userId: string) {
    const rows = await this.prisma.buyerCategory.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    const cats = await this.categoriesWithPath(rows.map((r) => r.categoryId));
    return {
      max: BUYER_BOOK_MAX,
      items: rows.map((r) => {
        const cat = cats.get(r.categoryId);
        return {
          categoryId: r.categoryId,
          name: cat?.name ?? `دسته ${r.categoryId}`,
          rootName: cat?.rootName ?? '',
          parentName: cat?.parentName ?? '',
          unit: r.unit,
          minAmount: r.volumeMin,
          period: r.period,
        };
      }),
    };
  }

  /** POST /buyers/saveMyBook — جایگزینی کامل (تیک برگ‌ها + حداقل + دوره) */
  async saveMyBook(userId: string, dto: SaveMyBookDto) {
    const items = dto.items ?? [];
    if (items.length > BUYER_BOOK_MAX) {
      throw AppError.badRequest(`حداکثر ${BUYER_BOOK_MAX} دسته در دفتر خرید ممکن است.`, 'BOOK_MAX');
    }
    // یکتایی دسته‌ها
    const seen = new Set<number>();
    for (const it of items) {
      if (seen.has(it.categoryId)) {
        throw AppError.badRequest('هر دسته فقط یک‌بار قابل انتخاب است.', 'DUPLICATE_CATEGORY');
      }
      seen.add(it.categoryId);
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

    // واحد از خود دسته — قابل انتخاب کاربر نیست
    const cats = await this.categoriesWithPath([...seen]);
    const periodOf = (p: string) =>
      (BUYER_PERIODS as readonly string[]).includes(p) ? p : 'monthly';

    await this.prisma.$transaction([
      this.prisma.buyerCategory.deleteMany({ where: { userId } }),
      ...items.map((it: BuyerBookItemDto) => {
        const cat = cats.get(it.categoryId);
        return this.prisma.buyerCategory.create({
          data: {
            userId,
            categoryId: it.categoryId,
            volumeMin: it.volumeMin,
            period: periodOf(it.period),
            unit: cat?.unit ?? 'کیلوگرم',
          },
        });
      }),
    ]);

    return { saved: items.length };
  }

  // ─── دایرکتوری عمومی ────────────────────────────────────────────────────────

  /** POST /buyers/directory — آیتم‌محور: یک کارت برای هر کالای دفتر خرید.
   *  فیلتر: دسته (زیردرخت) + جستجو + دوره + استان/شهر + صفحه.
   *  نام نمایشی خریدار روی کارت می‌آید؛ تماس فقط از مسیر چت (خواستهٔ مالک ۱-۱۱).
   *  کارت‌های خودِ بینندهٔ واردشده حذف می‌شود — به خودش پیشنهاد نمی‌فرستد
   *  (رفع باگ «خریدار یافت نشد» ۱-۱۱: فروشنده روی کارت خودش می‌زد). */
  async directory(dto: GetBuyerDirectoryDto, viewerId: string | null = null) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(48, Math.max(1, dto.perPage ?? 12));

    // مجموعهٔ دسته‌های زیر دستهٔ انتخابی (خودش + زیر‌شاخه‌ها) — ردیف‌های دفتر
    // خرید همیشه برگ‌اند؛ فیلتر درختی درست درمی‌آید
    const leafSet = dto.categoryId
      ? new Set(await this.categories.getSubtreeIds(dto.categoryId))
      : null;

    // ردیف‌های دفتر خرید در این دسته‌ها (سقف اطمینان ۵۰۰۰ — دایرکتوری سبک می‌ماند)
    const rows = await this.prisma.buyerCategory.findMany({
      where: {
        ...(leafSet ? { categoryId: { in: [...leafSet] } } : {}),
        ...(dto.period ? { period: dto.period } : {}),
        ...(viewerId ? { userId: { not: viewerId } } : {}),
      },
      select: {
        id: true,
        userId: true,
        categoryId: true,
        volumeMin: true,
        period: true,
        unit: true,
      },
      take: 5000,
    });

    // نام دسته‌ها + مسیر — برای نمایش و جستجو
    const cats = await this.categoriesWithPath(rows.map((r) => r.categoryId));

    // جستجوی متنی روی نام/مسیر دسته
    const needle = dto.s?.trim() ?? '';
    const matched = needle
      ? rows.filter((r) => {
          const cat = cats.get(r.categoryId);
          return (
            !!cat &&
            (cat.name.includes(needle) ||
              cat.parentName.includes(needle) ||
              cat.rootName.includes(needle))
          );
        })
      : rows;

    // کاربران فعال + فیلتر مکان
    // ⚠️ مونگو: فیلتر null فیلدِ غایب را نمی‌گیرد → پنجرهٔ فعالیت =
    // lastSeenAt (هست) یا createdAt (هیچ‌وقت نبض نزده) — چون lastSeenAt
    // همیشه ≥ createdAt است، این دقیقاً max(هر دو) است.
    // غایب‌های بیش از ۹۰ روز «کم‌رنگ» می‌شوند (نه حذف) — پنجرهٔ کامل ۱۸۰ روز.
    const cutoff = new Date(Date.now() - STALE_WINDOW_MS);
    const userIds = [...new Set(matched.map((r) => r.userId))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: {
            id: { in: userIds },
            isActive: true,
            OR: [{ lastSeenAt: { gte: cutoff } }, { createdAt: { gte: cutoff } }],
            ...(dto.provinceId != null ? { provinceId: dto.provinceId } : {}),
            ...(dto.cityId != null ? { cityId: dto.cityId } : {}),
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            provinceId: true,
            cityId: true,
            lastSeenAt: true,
            createdAt: true,
          },
        })
      : [];

    // مکان‌ها — یک‌جا
    const locations = await this.locationNames(
      users.flatMap((u) => [u.provinceId, u.cityId].filter((x): x is number => x != null)),
    );

    // کارت‌ها — فعال‌ترها اول؛ غایب‌های ۹۰ روزه آخر و کم‌رنگ
    const now = Date.now();
    const userById = new Map(users.map((u) => [u.id, u]));
    const items: BuyerDirectoryEntry[] = [];
    for (const r of matched) {
      const u = userById.get(r.userId);
      if (!u) continue; // ردیف کاربر غیرفعال/غایب — رها
      const cat = cats.get(r.categoryId);
      const last = u.lastSeenAt ?? u.createdAt;
      items.push({
        id: r.id,
        buyerId: u.id,
        buyerName: `${u.firstName} ${u.lastName}`.trim() || 'خریدار ایمچ',
        role: buyerRole(r.unit, r.volumeMin),
        categoryId: r.categoryId,
        categoryName: cat?.name ?? `دسته ${r.categoryId}`,
        rootName: cat?.rootName ?? '',
        categoryPath: [cat?.rootName, cat?.parentName].filter(Boolean).join(' / '),
        unit: r.unit,
        minAmount: r.volumeMin,
        period: r.period,
        province: u.provinceId != null ? (locations.get(`p${u.provinceId}`) ?? null) : null,
        city: u.cityId != null ? (locations.get(`c${u.cityId}`) ?? null) : null,
        lastActiveAt: last,
        activeRecently: now - last.getTime() < RECENT_WINDOW_MS,
        stale: now - last.getTime() >= ACTIVE_WINDOW_MS,
      });
    }
    items.sort((a, b) => {
      if (a.stale !== b.stale) return a.stale ? 1 : -1;
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

  /** POST /buyers/sendSupplyOffer — تکی، رایگان تا سقف روزانهٔ سطح بسته.
   *  دکمهٔ ارسال سمت سایت فقط با دستهٔ آخر (برگ) فعال می‌شود؛ همین گیت اینجا
   *  هم تکرار می‌شود و دستهٔ هر پیشنهاد ذخیره می‌شود تا خریدار بتواند
   *  پیشنهادهای دریافتی را بر اساس دسته/نوع کالا فیلتر و مقایسه کند.
   *  گیت کالا (خواسته مالک ۴-۱۱): فروشنده باید همان گروه کالا را در
   *  محصولات خودش داشته باشد — به کالایی که نمی‌فروشد پیشنهاد نمی‌دهد. */
  async sendSupplyOffer(user: AuthUser, dto: SendSupplyOfferDto) {
    const gates = await this.offerGates(user, 1);
    const message = dto.message.trim();
    const terms = this.normalizeTerms(dto);
    await this.assertLeafCategory(terms.categoryId);
    await this.assertSellerHasProduct(user.id, terms.categoryId, terms.productType);

    // به خودت پیشنهاد نفرست — پیام شفاف، نه «خریدار یافت نشد» (رفع باگ ۱-۱۱)
    if (dto.buyerId === user.id) {
      throw AppError.badRequest(
        'این کارتِ خود شماست؛ پیشنهاد تامین به خریداران دیگر ارسال می‌شود.',
        'SELF_OFFER',
      );
    }

    // خریدار هدف — باید دفتر خرید پر داشته باشد و فعال باشد
    const target = await this.prisma.user.findUnique({
      where: { id: dto.buyerId },
      select: { id: true, isActive: true },
    });
    if (!target || !target.isActive) {
      throw AppError.notFound('خریدار یافت نشد.');
    }
    const targetBook = await this.prisma.buyerCategory.count({ where: { userId: target.id } });
    if (targetBook === 0) {
      throw AppError.notFound('خریدار یافت نشد.');
    }
    // پیشنهادِ دسته‌دار فقط به خریداری که در همان دسته نیاز ثبت کرده است
    if (terms.categoryId != null) {
      const inCat = await this.prisma.buyerCategory.count({
        where: { userId: target.id, categoryId: terms.categoryId },
      });
      if (inCat === 0) {
        throw AppError.badRequest(
          'این خریدار در دستهٔ انتخابی شما نیاز خرید ثبت نکرده است.',
          'BUYER_NOT_IN_CATEGORY',
        );
      }
    }

    // سهمیهٔ خریدارانِ متمایز امروز — تکرار به همان خریدار سهمیه نمی‌گیرد
    const contacted = await this.contactedBuyerIdsToday(user.id);
    if (!contacted.has(target.id) && gates.usedToday >= gates.limit) {
      throw AppError.badRequest(
        `سهمیهٔ پیشنهاد تامین امروز شما پر شده است (${gates.limit} خریدار در شبانه‌روز). برای ظرفیت بیشتر، بستهٔ بالاتر تهیه کنید یا از «ارسال گروهی» استفاده کنید.`,
        'OFFER_LIMIT_REACHED',
      );
    }

    // تحویل پیام چت (متن + بلوک شرایط تامین) — بعد ذخیرهٔ ردیف با threadId
    const unit = await this.unitOfCategory(terms.categoryId);
    const threadId = await this.deliverOfferMessage(
      user.id,
      target.id,
      message + this.termsBlock(terms, unit),
    );
    const offer = await this.prisma.supplyOffer.create({
      data: { sellerId: user.id, buyerId: target.id, message, isGroup: false, fee: 0, threadId, ...terms },
    });

    const left = Math.max(0, gates.limit - gates.usedToday - (contacted.has(target.id) ? 0 : 1));
    return { offerId: offer.id, threadId, quotaLeft: left };
  }

  /** POST /buyers/groupSendSupplyOffer — گروهی، پولی از کیف پول (اتمیک) */
  async groupSendSupplyOffer(user: AuthUser, dto: GroupSendSupplyOfferDto) {
    const billing = await this.settings.getBilling();
    const ids = [...new Set(dto.buyerIds)];
    const gates = await this.offerGates(user, ids.length);
    const message = dto.message.trim();
    const terms = this.normalizeTerms(dto);
    await this.assertLeafCategory(terms.categoryId);
    // گیت کالا (خواسته مالک ۴-۱۱) — همان ارسال تکی
    await this.assertSellerHasProduct(user.id, terms.categoryId, terms.productType);

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

    // اهداف — فعال + دفتر خرید پر؛ اگر دسته ارسال شده، دفتر باید همان دسته را داشته باشد
    const targets = await this.prisma.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true },
    });
    const books = await this.prisma.buyerCategory
      .groupBy({
        by: ['userId'],
        where: {
          userId: { in: ids },
          ...(terms.categoryId != null ? { categoryId: terms.categoryId } : {}),
        },
      })
      .then((g) => new Set(g.map((x) => x.userId)));
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
        for (const t of valid) {
          await tx.supplyOffer.create({
            data: {
              sellerId: user.id,
              buyerId: t.id,
              message,
              isGroup: true,
              fee: billing.groupSend.perRecipientPrice,
              ...terms,
            },
          });
        }
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

    // تحویل پیام چت — پس از تراکنش؛ بهترین‌حالتی (خطای یکی مانع بقیه نمی‌شود).
    // threadId هر ردیف بعد از تحویل با id همان جفت پر می‌شود؛ گفتگوی هر جفت
    // (فروشنده، خریدار) یکتاست پس به‌روزرسانی همهٔ ردیف‌های همین جفت با یک
    // threadId همیشه درست است. (فیلتر threadId:null استفاده نمی‌شود — مونگوی
    // پرایسما سندِ بی‌فیلد را با null نمی‌گیرد؛ مستند در directory)
    const unit = await this.unitOfCategory(terms.categoryId);
    const fullText = message + this.termsBlock(terms, unit);
    for (const t of valid) {
      const threadId = await this.deliverOfferMessage(user.id, t.id, fullText).catch(
        () => null,
      );
      if (threadId) {
        await this.prisma.supplyOffer
          .updateMany({
            where: { sellerId: user.id, buyerId: t.id },
            data: { threadId },
          })
          .catch(() => undefined);
      }
    }

    return {
      sent: valid.length,
      fee,
      perRecipient: billing.groupSend.perRecipientPrice,
      balance,
      groupLeft: Math.max(0, billing.groupSend.maxPerDay - gates.groupUsedToday - valid.length),
    };
  }

  /** POST /buyers/getMyReceivedOffers — پیشنهادهای تامین دریافتی من (پنل
   *  خریدار): فیلتر دسته/نوع کالا/چک/ارسال + صفحه‌بندی؛ برای مقایسه و
   *  انتخاب آسان‌تر بین فروشندگان (خواستهٔ مالک ۱-۱۱). */
  async myReceivedOffers(userId: string, dto: GetMyReceivedOffersDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(24, Math.max(1, dto.perPage ?? 10));
    const productType = dto.productType?.trim();

    const where: Prisma.SupplyOfferWhereInput = {
      buyerId: userId,
      ...(dto.categoryId != null ? { categoryId: dto.categoryId } : {}),
      ...(productType ? { productType: { contains: productType } } : {}),
      ...(dto.hasCheck ? { checkAccepted: true } : {}),
      ...(dto.hasDelivery ? { deliveryToBuyer: true } : {}),
    };

    const [rows, total, catRows] = await Promise.all([
      this.prisma.supplyOffer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.supplyOffer.count({ where }),
      // دسته‌های یکتای پیشنهادهای این خریدار — برای فیلتر انتخابی بالای صفحه
      this.prisma.supplyOffer.findMany({
        where: { buyerId: userId, categoryId: { not: null } },
        select: { categoryId: true },
        distinct: ['categoryId'],
      }),
    ]);

    const catIds = catRows.map((r) => r.categoryId).filter((x): x is number => x != null);
    const cats = await this.categoriesWithPath(catIds);

    const sellerIds = [...new Set(rows.map((r) => r.sellerId))];
    const sellers = sellerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: sellerIds } },
          select: { id: true, firstName: true, lastName: true, isVerified: true },
        })
      : [];
    const sellerById = new Map(sellers.map((s) => [s.id, s]));

    const items = rows.map((r) => {
      const s = sellerById.get(r.sellerId);
      const cat = r.categoryId != null ? cats.get(r.categoryId) : undefined;
      return {
        id: r.id,
        sellerId: r.sellerId,
        sellerName: `${s?.firstName ?? ''} ${s?.lastName ?? ''}`.trim() || 'فروشنده ایمچ',
        sellerVerified: s?.isVerified ?? false,
        categoryId: r.categoryId,
        categoryName: cat?.name ?? null,
        categoryPath: cat ? [cat.rootName, cat.parentName].filter(Boolean).join(' / ') : null,
        productType: r.productType,
        message: r.message,
        checkAccepted: r.checkAccepted,
        checkPercent: r.checkPercent,
        checkMaxDays: r.checkMaxDays,
        deliveryToBuyer: r.deliveryToBuyer,
        shippingCostBy: r.shippingCostBy,
        minOrderAmount: r.minOrderAmount,
        unit: cat?.unit ?? 'کیلوگرم',
        isGroup: r.isGroup,
        threadId: r.threadId,
        createdAt: r.createdAt,
      };
    });

    return {
      items,
      total,
      page,
      perPage,
      categories: [...cats.entries()]
        .map(([id, c]) => ({ id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fa')),
    };
  }

  /** POST /buyers/getMySentOffers — پیشنهادهای تامین ارسالی من (پنل فروشنده،
   *  خواسته مالک ۴-۱۱): چه کالاهایی، به چه کسانی، هزینه و تاریخ؛ برای هر
   *  پیشنهادِ چت‌دار، آخرین پیام همان گفتگو هم می‌آید تا فروشنده ببیند
   *  بعدش چه شد (خریدار جواب داد یا نه) و مستقیم به گفتگو برود. */
  async mySentOffers(userId: string, dto: GetMySentOffersDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(48, Math.max(1, dto.perPage ?? 20));

    const where: Prisma.SupplyOfferWhereInput = {
      sellerId: userId,
      ...(dto.categoryId != null ? { categoryId: dto.categoryId } : {}),
    };

    const [rows, total, catRows] = await Promise.all([
      this.prisma.supplyOffer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.supplyOffer.count({ where }),
      // دسته‌های یکتای همهٔ پیشنهادهای من — فیلتر انتخابی بالای صفحه
      this.prisma.supplyOffer.findMany({
        where: { sellerId: userId, categoryId: { not: null } },
        select: { categoryId: true },
        distinct: ['categoryId'],
      }),
    ]);

    const catIds = catRows.map((r) => r.categoryId).filter((x): x is number => x != null);
    const cats = await this.categoriesWithPath(catIds);

    const buyerIds = [...new Set(rows.map((r) => r.buyerId))];
    const buyers = buyerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: buyerIds } },
          select: { id: true, firstName: true, lastName: true, isVerified: true, userName: true },
        })
      : [];
    const buyerById = new Map(buyers.map((b) => [b.id, b]));

    // آخرین پیام هر گفتگوی مرتبط — «بعدش چه شد» روی هر کارت
    const threadIds = [...new Set(rows.map((r) => r.threadId).filter((x): x is string => !!x))];
    const lastMessages = new Map<string, { text: string; at: Date; mine: boolean }>();
    for (const threadId of threadIds) {
      const msg = await this.prisma.chatMessage.findFirst({
        where: { threadId },
        orderBy: { createdAt: 'desc' },
        select: { text: true, createdAt: true, senderId: true },
      }).catch(() => null);
      if (msg) {
        lastMessages.set(threadId, { text: msg.text, at: msg.createdAt, mine: msg.senderId === userId });
      }
    }

    const items = rows.map((r) => {
      const b = buyerById.get(r.buyerId);
      const cat = r.categoryId != null ? cats.get(r.categoryId) : undefined;
      const last = r.threadId ? lastMessages.get(r.threadId) ?? null : null;
      return {
        id: r.id,
        buyerId: r.buyerId,
        buyerName: `${b?.firstName ?? ''} ${b?.lastName ?? ''}`.trim() || 'خریدار ایمچ',
        buyerUserName: b?.userName ?? null,
        buyerVerified: b?.isVerified ?? false,
        categoryId: r.categoryId,
        categoryName: cat?.name ?? null,
        categoryPath: cat ? [cat.rootName, cat.parentName].filter(Boolean).join(' / ') : null,
        productType: r.productType,
        message: r.message,
        isGroup: r.isGroup,
        fee: r.fee,
        threadId: r.threadId,
        createdAt: r.createdAt,
        lastMessage: last ? { text: last.text, at: last.at, mine: last.mine } : null,
      };
    });

    return {
      items,
      total,
      page,
      perPage,
      categories: [...cats.entries()]
        .map(([id, c]) => ({ id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fa')),
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

  /** شرایط ساختاریافتهٔ تامین (خواستهٔ مالک ۱-۱۱): اعتبارسنجیِ وابستگی
   *  سوییچ‌ها — چک روشن است ولی درصد/سرسید ندارد؟ ارسال به محل روشن است ولی
   *  پرداخت‌کنندهٔ حمل ندارد؟ همین‌جا خطای شفاف؛ فیلدهای سوییچِ خاموش همیشه
   *  خالی می‌شوند تا فیلتر خریدار هیچ‌وقت روی دادهٔ ناقص نیفتد. */
  private normalizeTerms(dto: SupplyOfferTermsDto): OfferTerms {
    const checkAccepted = dto.checkAccepted === true;
    const deliveryToBuyer = dto.deliveryToBuyer === true;
    if (checkAccepted && (dto.checkPercent == null || dto.checkMaxDays == null)) {
      throw AppError.badRequest(
        'برای پرداخت چکی، «درصد مبلغ با چک» و «حداکثر سرسید چک» را مشخص کنید.',
        'CHECK_TERMS_INCOMPLETE',
      );
    }
    if (
      deliveryToBuyer &&
      dto.shippingCostBy !== 'seller' &&
      dto.shippingCostBy !== 'customer'
    ) {
      throw AppError.badRequest(
        'پرداخت‌کنندهٔ هزینهٔ حمل (فروشنده یا مشتری) را مشخص کنید.',
        'SHIPPING_PAYER_REQUIRED',
      );
    }
    const productType = dto.productType?.trim();
    return {
      ...(dto.categoryId != null ? { categoryId: dto.categoryId } : {}),
      ...(productType ? { productType: productType.slice(0, 60) } : {}),
      checkAccepted,
      ...(checkAccepted ? { checkPercent: dto.checkPercent!, checkMaxDays: dto.checkMaxDays! } : {}),
      deliveryToBuyer,
      ...(deliveryToBuyer ? { shippingCostBy: dto.shippingCostBy! } : {}),
      ...(dto.minOrderAmount != null && dto.minOrderAmount > 0
        ? { minOrderAmount: dto.minOrderAmount }
        : {}),
    };
  }

  /** گیت دستهٔ آخر — دکمهٔ ارسال سمت سایت فقط با انتخاب برگ فعال می‌شود؛
   *  همین‌جا هم تکرار می‌شود تا هیچ راهی دستهٔ میانی را ثبت نکند. */
  private async assertLeafCategory(categoryId?: number) {
    if (categoryId == null) return;
    const children = await this.prisma.category.count({ where: { parentId: categoryId } });
    if (children > 0) {
      throw AppError.badRequest(
        'برای ارسال پیشنهاد تامین، دستهٔ آخر کالا را انتخاب کنید.',
        'CATEGORY_NOT_LEAF',
      );
    }
  }

  /** گیت کالا (خواسته مالک ۴-۱۱) — فروشنده باید همان گروه کالا (دستهٔ برگ)
   *  را در محصولات خودش داشته باشد؛ اگر «نوع» هم وارد کرده باشد و هیچ
   *  محصولش از همان نوع نباشد، پیام شفاف می‌گیرد: برای تامین سیب قرمز
   *  باید این کالا را در لیست محصولات خود داشته باشید. */
  private async assertSellerHasProduct(
    sellerId: string,
    categoryId?: number,
    productType?: string,
  ) {
    if (categoryId == null) return;

    const mine = await this.prisma.product.findMany({
      where: { userId: sellerId, subCategoryId: categoryId, status: { in: ['pending', 'confirmed'] } },
      select: { productName: true },
      take: 50,
    });

    const cats = await this.categoriesWithPath([categoryId]);
    const catName = cats.get(categoryId)?.name ?? 'این کالا';

    if (mine.length === 0) {
      throw AppError.badRequest(
        `برای ارسال پیشنهاد تامین ${catName} باید این کالا را در لیست محصولات خود داشته باشید.`,
        'PRODUCT_REQUIRED',
      );
    }

    // نوع کالا (اختیاری) — تطبیق متنِ گسترده: نام آگهی خود فروشنده یا نوع
    // استخراج‌شدهٔ آن باید شامل نوعِ واردشده باشد (یا برعکس)؛ آگهیِ فقط‌برگ
    // (بدون نوع) به‌مثابهٔ «هر نوعی از همین دسته» حساب می‌شود
    const type = productType?.trim();
    if (type) {
      const norm = (s: string) => s.replace(/[\u200c\s]+/g, ' ').trim();
      const leaf = catName;
      const ok = mine.some((p) => {
        const name = norm(p.productName).replace(leaf, ' ').trim();
        if (!name) return true; // آگهی فقط‌برگ — نوع را مشخص نکرده
        const t = norm(type);
        return name.includes(t) || t.includes(name) || norm(p.productName).includes(t);
      });
      if (!ok) {
        throw AppError.badRequest(
          `برای پیشنهاد تامین نوع «${type}» باید همین کالا را در لیست محصولات خود داشته باشید.`,
          'PRODUCT_TYPE_REQUIRED',
        );
      }
    }
  }

  /** واحد دسته — برای جملهٔ «حداقل خرید: ۵۰۰ کیلوگرم» در بلوک شرایط */
  private async unitOfCategory(categoryId?: number): Promise<string> {
    if (categoryId == null) return 'کیلوگرم';
    const cats = await this.categoriesWithPath([categoryId]);
    return cats.get(categoryId)?.unit ?? 'کیلوگرم';
  }

  /** بلوک «شرایط تامین» که به انتهای پیام چت می‌چسبد — خریدار همهٔ مزایا را
   *  همان‌جا در چت می‌بیند؛ پنل خریدار همین شرایط را به‌صورت فیلتر/چیپ دارد. */
  private termsBlock(terms: OfferTerms, unit: string): string {
    const fa = (n: number) => n.toLocaleString('fa-IR');
    const lines: string[] = [];
    if (terms.productType) lines.push(`نوع کالا: ${terms.productType}`);
    if (terms.minOrderAmount != null) {
      lines.push(`حداقل خرید: ${fa(terms.minOrderAmount)} ${unit}`);
    }
    if (terms.checkAccepted && terms.checkPercent != null && terms.checkMaxDays != null) {
      lines.push(
        `پرداخت با چک: تا ${fa(terms.checkPercent)}٪ مبلغ، سرسید حداکثر ${fa(terms.checkMaxDays)} روز`,
      );
    }
    if (terms.deliveryToBuyer) {
      lines.push(
        `ارسال: به محل شما؛ هزینهٔ حمل با ${terms.shippingCostBy === 'seller' ? 'فروشنده' : 'مشتری'}`,
      );
    }
    if (lines.length === 0) return '';
    return `\n\n— شرایط تامین —\n${lines.map((l) => `• ${l}`).join('\n')}`;
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
    // گفتگوی جفت فروشنده↔خریدار — یک مکالمه به‌ازای جفت (خواسته مالک ۴-۱۱)،
    // در هر دو جهت؛ آگهی زمینه ندارد (پیام پیشنهاد مستقیم است) — upsert با
    // بازیابی P2002
    let thread = await this.prisma.chatThread.findFirst({
      where: {
        OR: [
          { sellerId, buyerId },
          { sellerId: buyerId, buyerId: sellerId },
        ],
      },
    });
    if (thread) {
      // پیشنهادها همیشه در همان گفتگوی جفت ادامه می‌یابند — فقط زمینه‌اش
      // گفتگوی مستقیم می‌ماند تا عنوان مکالمه گمراه‌کننده نشود
      if (thread.productId != null) {
        thread = await this.prisma.chatThread
          .update({ where: { id: thread.id }, data: { productId: null } })
          .catch(() => thread);
      }
    }
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
            where: {
              OR: [
                { sellerId, buyerId },
                { sellerId: buyerId, buyerId: sellerId },
              ],
            },
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

  /** نام دسته + مسیر (ریشه/پدر) و واحد بر اساس id — دو کوئری حداکثر */
  private async categoriesWithPath(ids: number[]) {
    if (ids.length === 0) {
      return new Map<number, { name: string; rootName: string; parentName: string; unit: string }>();
    }
    const uniq = [...new Set(ids)];
    const rows = await this.prisma.category.findMany({
      where: { id: { in: uniq } },
      select: { id: true, categoryName: true, parentId: true, unit: true },
    });
    const parentIds = [...new Set(rows.map((r) => r.parentId).filter((x): x is number => x != null))];
    const parents = parentIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: parentIds } },
          select: { id: true, categoryName: true, parentId: true },
        })
      : [];
    // جدّها (ریشهٔ درخت) — سطح سوم؛ بدون این کوئری rootName اشتباه می‌شد
    // (باگ قدیمی: «میوه / میوه» به‌جای «کشاورزی / میوه»)
    const grandIds = [...new Set(parents.map((p) => p.parentId).filter((x): x is number => x != null))];
    const grands = grandIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: grandIds } },
          select: { id: true, categoryName: true },
        })
      : [];
    const parentById = new Map(parents.map((p) => [p.id, p]));
    const grandById = new Map(grands.map((g) => [g.id, g]));
    const out = new Map<
      number,
      { name: string; rootName: string; parentName: string; unit: string }
    >();
    for (const r of rows) {
      const parent = r.parentId != null ? parentById.get(r.parentId) : undefined;
      const root = parent?.parentId != null ? grandById.get(parent.parentId) : undefined;
      out.set(r.id, {
        name: r.categoryName,
        unit: r.unit ?? 'کیلوگرم',
        parentName: parent?.categoryName ?? '',
        rootName: root?.categoryName ?? parent?.categoryName ?? '',
      });
    }
    return out;
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

