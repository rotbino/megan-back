import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

/**
 * همه خطاها (اعم از HttpException و خطاهای غیرمنتظره) به شکل یکسان برمی‌گردند:
 *   { status: false, message: 'پیام فارسی قابل نمایش به کاربر', code?: 'OTP_WRONG' }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'خطای داخلی سرور؛ لطفاً کمی بعد دوباره تلاش کنید.';
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: unknown; code?: unknown };
        // خطاهای ValidationPipe آرایه‌اند → اولین پیام کافی است
        message = Array.isArray(b.message)
          ? String(b.message[0])
          : String(b.message ?? message);
        if (b.code) code = String(b.code);
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    response.status(status).send(
      code ? { status: false, message, code } : { status: false, message },
    );
  }
}
