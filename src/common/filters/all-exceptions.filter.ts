import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isProd } from '../config/env';

/**
 * نگاشت مرکزی خطاها — هر شکستی API را در «یک» شکل ترک می‌کند (قرارداد پروژه):
 *
 *   { status: false, message: «پیام فارسی کاربر», code: «STABLE_MACHINE_CODE», fields? }
 *
 * فرانت روی `code` منطق می‌بندد و `message` را نمایش می‌دهد.
 * (منطق نرمال‌سازی از imach-back پورت شده؛ شکل خروجی قرارداد مگان است.)
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // AppError / خطای ساخته‌شده با {code, message} → همان شکل
      if (typeof body === 'object' && body !== null && 'code' in (body as Record<string, unknown>)) {
        const { code, ...rest } = body as { code: string } & Record<string, unknown>;
        reply.code(status).send({ status: false, code, ...rest });
        return;
      }

      // پیام‌های ساختاری ValidationPipe → فیلدها جدا می‌شوند
      if (typeof body === 'object' && body !== null && 'message' in (body as Record<string, unknown>)) {
        const raw = (body as { message?: unknown }).message;
        const fields = Array.isArray(raw) ? raw : undefined;
        const humanMsg =
          typeof raw === 'string' && raw.length > 0 && raw.length < 200
            ? raw
            : status === HttpStatus.BAD_REQUEST
              ? 'اطلاعات ارسالی معتبر نیست.'
              : 'خطایی رخ داد؛ دوباره تلاش کنید.';

        if (status === HttpStatus.TOO_MANY_REQUESTS) {
          reply.code(status).send({
            status: false,
            message: 'درخواست‌های شما زیاد است؛ کمی بعد تلاش کنید.',
            code: 'RATE_LIMITED',
          });
          return;
        }

        // کدهای پایدار برای استثناهای داخلی Nest
        const code =
          status === HttpStatus.BAD_REQUEST
            ? 'VALIDATION_ERROR'
            : status === HttpStatus.UNAUTHORIZED
              ? 'UNAUTHORIZED'
              : status === HttpStatus.FORBIDDEN
                ? 'FORBIDDEN'
                : status === HttpStatus.NOT_FOUND
                  ? 'NOT_FOUND'
                  : status === HttpStatus.CONFLICT
                    ? 'CONFLICT'
                    : 'HTTP_ERROR';

        reply.code(status).send({
          status: false,
          message: humanMsg,
          code,
          ...(fields ? { fields } : {}),
        });
        return;
      }

      reply.code(status).send({
        status: false,
        message: exception.message || 'خطایی رخ داد.',
        code: 'HTTP_ERROR',
      });
      return;
    }

    // Prisma error shape {code, message, meta}
    if (typeof exception === 'object' && exception !== null && 'code' in exception) {
      const prismaErr = exception as { code?: string; message?: string };
      if (prismaErr.code === 'P2025') {
        reply.code(404).send({ status: false, message: 'رکورد مورد نظر یافت نشد.', code: 'NOT_FOUND' });
        return;
      }
      if (prismaErr.code === 'P2002') {
        reply.code(409).send({
          status: false,
          message: 'این مقدار قبلاً ثبت شده است.',
          code: 'CONFLICT',
        });
        return;
      }
    }

    this.logger.error({ err: exception, url: request.url }, 'unhandled error');
    reply.code(500).send({
      status: false,
      message: isProd ? 'خطای داخلی سرور.' : String(exception instanceof Error ? exception.message : exception),
      code: 'INTERNAL_ERROR',
    });
  }
}
