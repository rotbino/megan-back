import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.module';
import { AppError } from '../../common/errors/app-error';
import { GetAdminActionsDto } from './dto';

/** ورودی ثبت لاگ — توسط AdminActionInterceptor پر می‌شود */
export interface AdminActionEntry {
  adminId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  payload?: unknown;
  message?: string;
}

/**
 * فاز A5 — لاگ عملیات‌های ادمین (AdminAction).
 *
 * ثبت خودکار توسط AdminActionInterceptor انجام می‌شود (هر mutation موفق
 * ادمین)؛ این سرویس نوشتنِ مطمئن (fire-and-forget — هرگز عملیات اصلی را
 * نمی‌شکند) + خواندنِ فیلترشده را ارائه می‌کند.
 *
 * اصل نرمال‌سازی: فقط adminId ذخیره می‌شود؛ نام/نقش ادمین هنگام خواندن
 * join می‌شود — تغییر نام ادمین لاگ قدیمی را بی‌اعتبار نمی‌کند.
 */
@Injectable()
export class AdminActionsService {
  private readonly logger = new Logger(AdminActionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ثبت یک عملیات — هرگز throw نمی‌کند (لاگ نباید پاسخ کاربر را عقب بیندازد).
   * خطا فقط در لاگ pino دیده می‌شود.
   */
  async log(entry: AdminActionEntry): Promise<void> {
    try {
      await this.prisma.adminAction.create({
        data: {
          adminId: entry.adminId,
          action: entry.action,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          payload: (entry.payload ?? undefined) as never,
          message: entry.message?.slice(0, 300) ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`admin-action-log: ثبت عملیات «${entry.action}» ناموفق بود`, err as Error);
    }
  }

  /** POST /admin/actions/getAdminActions — لاگ فیلترشده + صفحه‌بندی */
  async getAdminActions(dto: GetAdminActionsDto) {
    const page = Math.max(1, dto.page ?? 1);
    const perPage = Math.min(100, Math.max(1, dto.perPage ?? 30));

    const dateFrom = this.parseDate(dto.dateFrom, 'تاریخ «از»');
    const dateTo = this.parseDate(dto.dateTo, 'تاریخ «تا»');

    const where: Record<string, unknown> = {
      ...(dto.adminId ? { adminId: dto.adminId } : {}),
      ...(dto.action ? { action: { contains: dto.action } } : {}),
      ...(dto.targetType ? { targetType: dto.targetType } : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.adminAction.count({ where }),
      this.prisma.adminAction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          admin: { select: { id: true, username: true, name: true, role: true } },
        },
      }),
    ]);

    return {
      total,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        payload: r.payload,
        message: r.message,
        createdAt: r.createdAt,
        admin: {
          id: r.admin.id,
          username: r.admin.username,
          name: r.admin.name,
          role: r.admin.role,
        },
      })),
    };
  }

  /** آخرین N عملیات — برای داشبورد (getRecentActivity) */
  async getRecentActions(limit = 12) {
    const rows = await this.prisma.adminAction.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(50, Math.max(1, limit)),
      include: {
        admin: { select: { id: true, username: true, name: true, role: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      message: r.message,
      createdAt: r.createdAt,
      admin: { id: r.admin.id, name: r.admin.name, username: r.admin.username, role: r.admin.role },
    }));
  }

  // ─── داخلی ─────────────────────────────────────────────────────────────

  private parseDate(value: string | undefined, label: string): Date | undefined {
    if (!value) return undefined;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw AppError.badRequest(`${label} معتبر نیست.`);
    }
    return d;
  }
}
