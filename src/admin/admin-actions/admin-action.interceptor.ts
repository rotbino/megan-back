import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AdminActionsService } from './admin-actions.service';

/** request تزئینشده توسط AdminJwtAuthGuard (adminId فقط روی مسیرهای ادمین است) */
interface AdminRequest {
  adminId?: string;
  adminUsername?: string;
  method?: string;
  url?: string;
  routerPath?: string;
  routeOptions?: { url?: string; method?: string };
  body?: Record<string, unknown>;
}

/** کلیدهایی که هرگز در لاگ ذخیره نمی‌شوند (حساس یا حجیم) */
const SENSITIVE_KEYS = /password|secret|token|hash|authorization|receipt/i;

/** نام‌های عملیات خواندنی/نشستی — mutation محسوب نمی‌شوند */
const SKIP_ACTIONS = new Set(['login', 'logout', 'me']);

/** اولویت استخراج شناسه هدف از body */
const TARGET_ID_KEYS = ['productId', 'userId', 'orderId', 'adminId', 'categoryId', 'locationId', 'id'];

/** نوع هدف از روی بخش دوم مسیر admin/<بخش>/<عملیات> */
const TARGET_TYPE_BY_SECTION: Record<string, string> = {
  products: 'product',
  users: 'user',
  messages: 'user',
  'buy-requests': 'buy_request',
  wallet: 'charge_order',
  'base-data': 'base_data',
  admins: 'admin',
  auth: 'admin',
  actions: 'admin_action',
};

/** رشته‌های بلند کوتاه می‌شوند — لاگ خلاصه است نه آرشیو */
const MAX_STRING = 120;

function summarize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return depth >= 2 ? value.length : value.slice(0, 10).map((v) => summarize(v, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= 3) return '[object]';
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(k)) {
        out[k] = '[حذف شد]';
        continue;
      }
      out[k] = summarize(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * فاز A5 — ثبت خودکار هر mutation موفق ادمین در AdminAction.
 *
 * سراسری رجیستر می‌شود (APP_INTERCEPTOR در AdminModule) ولی فقط درخواست‌هایی
 * را می‌بیند که AdminJwtAuthGuard قبلاً adminId روی request گذاشته باشد —
 * یعنی دقیقاً همان مسیرهای ادمینِ احرازشده. گاردها قبل از interceptor ها
 * اجرا می‌شوند، پس این تضمین شده است.
 *
 *  • فقط POST های /admin/* با عملیات غیر-خواندنی (نامی که با get شروع نشود
 *    و در {login, logout, me} نباشد)
 *  • فقط پاسخ موفق (status=true) — خطاها در pino لاگ می‌شوند
 *  • fire-and-forget: شکست ثبت هرگز پاسخ اصلی را خراب نمی‌کند
 */
@Injectable()
export class AdminActionInterceptor implements NestInterceptor {
  constructor(
    private readonly actions: AdminActionsService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AdminRequest>();

    if (!req?.adminId || (req.method ?? 'POST').toUpperCase() !== 'POST') {
      return next.handle();
    }

    const path = req.routeOptions?.url ?? req.routerPath ?? (req.url ?? '').split('?')[0];
    if (!path.includes('/admin/')) return next.handle();

    const segments = path.split('/').filter(Boolean); // [api, v1, admin, <بخش>, <عملیات>]
    const actionName = segments[segments.length - 1] ?? '';
    if (!actionName || actionName.startsWith('get') || SKIP_ACTIONS.has(actionName)) {
      return next.handle();
    }

    const section = segments[segments.length - 2] ?? '';
    const adminId = req.adminId;
    const action = `admin/${section}/${actionName}`;
    const targetType = TARGET_TYPE_BY_SECTION[section];
    const targetId = this.extractTargetId(req.body);
    const payload = req.body && Object.keys(req.body).length ? summarize(req.body) : undefined;

    return next.handle().pipe(
      tap((response) => {
        // فقط عملیات موفق — قرارداد پاسخ یکنواخت {status, message}
        if (response && typeof response === 'object' && (response as { status?: boolean }).status === true) {
          const message = (response as { message?: string }).message;
          // fire-and-forget — بدون await عمدی
          void this.actions.log({ adminId, action, targetType, targetId, payload, message });
        }
      }),
    );
  }

  private extractTargetId(body: Record<string, unknown> | undefined): string | undefined {
    if (!body) return undefined;
    for (const key of TARGET_ID_KEYS) {
      const v = body[key];
      if (typeof v === 'string' && /^[0-9a-f]{16,32}$/i.test(v)) return v;
      if (typeof v === 'number') return String(v);
    }
    return undefined;
  }
}
