import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService } from '../common/cache/cache.module';
import { AppError } from '../common/errors/app-error';
import { UploadsService } from '../uploads/uploads.service';
import type { AuthUser } from '../common/guards';
import { GetVerificationOrdersDto, ReviewVerificationDto } from './dto';

/** فیلدهای مدارک — اسلات‌های File برای relatedModel=Verification */
export const DOC_KEYS = ['nationalCard', 'selfie'] as const;

export interface VerificationDocDto {
  id: string;
  fieldKey: string;
  url: string;
  thumbUrl: string | null;
  createdAt: Date;
}

export interface MyVerificationDto {
  /** ObjectId سفارش — برای فراخوانی reviewVerification ادمین (A3) */
  orderId?: string | null;
  /** none | pending | approved | rejected */
  status: string;
  submittedAt?: Date;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
  docs: Partial<Record<(typeof DOC_KEYS)[number], VerificationDocDto | null>>;
}

/**
 * ─── احراز هویت اسناد (B6) ───────────────────────────────────────────────────
 * فلو عین باسکول: کاربر کارت ملی + سلفی را در پنل بارگذاری می‌کند →
 * «مدارک شما در حال بررسی است» → ادمین تأیید/رد می‌کند → نشان
 * «احراز هویت» روی پروفایل و آگهی‌ها (isVerified کاربر — هنگام خواندن join می‌شود).
 *
 * مدارک در «یک» درخواست multipart ارسال می‌شوند (تراکنش کاربر اتمیک):
 * سفارش ساخته می‌شود، هر دو مدرک از طریق UploadsService با replace=true
 * می‌چسبند و در خطا کل سفارش + فایل‌هایش جبران (حذف) می‌شوند — طبق
 * دکترین ضد-فایل-سرگردان هیچ بایت جامانده‌ای نمی‌ماند.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly uploads: UploadsService,
  ) {}

  /** POST /verification/submitVerification (multipart) — کارت ملی + سلفی */
  async submit(user: AuthUser, req: FastifyRequest): Promise<MyVerificationDto> {
    // ۱) وضعیت کاربر — فقط یک درخواست باز و بدون تکرار پس از تأیید
    const [pending, me] = await Promise.all([
      this.prisma.verificationOrder.findFirst({
        where: { userId: user.id, status: 'pending' },
        select: { id: true },
      }),
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: { isVerified: true },
      }),
    ]);
    if (pending) {
      throw AppError.conflict('درخواست احراز هویت شما در حال بررسی است.', 'VERIFICATION_PENDING');
    }
    if (me?.isVerified) {
      throw AppError.conflict('هویت شما قبلاً احراز شده است.', 'ALREADY_VERIFIED');
    }

    // ۲) خواندن مدارک — فقط این دو فیلد فایل پذیرفته می‌شوند
    const { files } = await this.uploads.readMultipartMulti(req, [...DOC_KEYS]);
    for (const key of DOC_KEYS) {
      if (!files.get(key)) {
        throw AppError.badRequest('تصویر کارت ملی و سلفی هر دو الزامی است.', 'DOC_MISSING');
      }
    }

    // ۳) سفارش (ردیف مرجع) → ۴) چسباندن مدارک با اعتبارسنجی کامل uploads
    const order = await this.prisma.verificationOrder.create({
      data: { userId: user.id },
    });
    try {
      for (const key of DOC_KEYS) {
        await this.uploads.upload(user, {
          model: 'Verification',
          modelId: order.id,
          fieldKey: key,
          replace: true, // اسلات تک‌فایلی — مدرک قبلی (اگر از رد قبلی) حذف شود
        }, files.get(key)!);
      }
    } catch (err) {
      // جبران: بایت‌ها + ردیف‌های File و خود سفارش — بدون جامانده
      await this.uploads.removeAllForModel('Verification', order.id).catch(() => undefined);
      await this.prisma.verificationOrder.delete({ where: { id: order.id } }).catch(() => undefined);
      throw err;
    }

    return this.getMy(user.id);
  }

  /** POST /verification/getMyVerification — وضعیت جاری + مدارک کاربر */
  async getMy(userId: string): Promise<MyVerificationDto> {
    const order = await this.prisma.verificationOrder.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!order) return { orderId: null, status: 'none', docs: {} };

    const rows = await this.prisma.file.findMany({
      where: { relatedModel: 'Verification', relatedId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    const docs: MyVerificationDto['docs'] = {};
    for (const key of DOC_KEYS) {
      const row = rows.find((r) => r.fieldKey === key);
      docs[key] = row
        ? {
            id: row.id,
            fieldKey: row.fieldKey,
            url: row.url,
            thumbUrl: row.thumbUrl,
            createdAt: row.createdAt,
          }
        : null;
    }

    return {
      orderId: order.id,
      status: order.status,
      submittedAt: order.createdAt,
      reviewedAt: order.reviewedAt,
      rejectionReason: order.rejectionReason,
      docs,
    };
  }

  /** POST /verification/getVerificationOrders (ادمین) — صف بررسی */
  async listOrders(dto: GetVerificationOrdersDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(50, Math.max(1, dto.perPage ?? 20));

    const where = {
      ...(dto.status ? { status: dto.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.verificationOrder.count({ where }),
      this.prisma.verificationOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    // کاربران + مدارک — گروهی، نه به‌ازای هر ردیف
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true, phone: true, userName: true, firstName: true, lastName: true, isVerified: true,
      },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const orderIds = rows.map((r) => r.id);
    const files = orderIds.length
      ? await this.prisma.file.findMany({
          where: { relatedModel: 'Verification', relatedId: { in: orderIds } },
          select: { id: true, relatedId: true, fieldKey: true, url: true, thumbUrl: true, createdAt: true },
        })
      : [];
    const fileMap = new Map<string, typeof files>();
    for (const f of files) {
      const list = fileMap.get(f.relatedId!) ?? [];
      list.push(f);
      fileMap.set(f.relatedId!, list);
    }

    return {
      total,
      page,
      perPage,
      items: rows.map((r) => {
        const u = userMap.get(r.userId);
        const docs = fileMap.get(r.id) ?? [];
        const doc = (key: string) =>
          docs.find((d) => d.fieldKey === key) ?? null;
        return {
          id: r.id,
          status: r.status,
          rejectionReason: r.rejectionReason,
          reviewedAt: r.reviewedAt,
          createdAt: r.createdAt,
          user: {
            id: r.userId,
            phone: u?.phone ?? '',
            user_name: u?.userName ?? '',
            first_name: u?.firstName ?? '',
            last_name: u?.lastName ?? '',
            is_verified: u?.isVerified ?? false,
          },
          docs: {
            nationalCard: doc('nationalCard'),
            selfie: doc('selfie'),
          },
        };
      }),
    };
  }

  /** POST /verification/reviewVerification (ادمین) — تأیید/رد */
  async review(admin: AuthUser, dto: ReviewVerificationDto) {
    if (!/^[0-9a-fA-F]{24}$/.test(dto.orderId)) {
      throw AppError.notFound('درخواست یافت نشد.');
    }
    const order = await this.prisma.verificationOrder.findUnique({ where: { id: dto.orderId } });
    if (!order) throw AppError.notFound('درخواست یافت نشد.');
    if (order.status !== 'pending') {
      throw AppError.conflict('این درخواست قبلاً بررسی شده است.', 'ALREADY_REVIEWED');
    }

    const reason = dto.rejectionReason?.trim();
    if (!dto.approve && !reason) {
      throw AppError.badRequest('دلیل رد شدن را وارد کنید.', 'REASON_REQUIRED');
    }

    if (dto.approve) {
      // تأیید: isVerified کاربر — نشان روی کارت‌ها هنگام خواندن با join ساخته می‌شود
      const [updated] = await this.prisma.$transaction([
        this.prisma.verificationOrder.update({
          where: { id: order.id },
          data: {
            status: 'approved',
            reviewedBy: admin.id,
            reviewedAt: new Date(),
          },
        }),
        this.prisma.user.update({
          where: { id: order.userId },
          data: { isVerified: true },
        }),
      ]);
      // آگهی‌های کش‌شده فوراً تازه شوند (نام فروشنده join است)
      this.cache.invalidateTag('products');
      return { id: updated.id, status: updated.status };
    }

    // رد: دلیل برای کاربر ذخیره می‌شود تا دوباره تلاش کند
    const updated = await this.prisma.verificationOrder.update({
      where: { id: order.id },
      data: {
        status: 'rejected',
        rejectionReason: reason,
        reviewedBy: admin.id,
        reviewedAt: new Date(),
      },
    });
    return { id: updated.id, status: updated.status };
  }
}
