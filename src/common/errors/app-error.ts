import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * خطای تایپ‌دار با `code` ماشینی پایدار + پیام فارسی قابل نمایش.
 * فیلتر مرکزی آن را به شکل {status:false, message, code} می‌فرستد.
 */
export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly fields?: unknown,
  ) {
    super({ code, message, ...(fields ? { fields } : {}) }, status);
  }

  static unauthorized(msg: string): AppError {
    return new AppError('UNAUTHORIZED', msg, HttpStatus.UNAUTHORIZED);
  }
  static forbidden(msg: string, code = 'FORBIDDEN'): AppError {
    return new AppError(code, msg, HttpStatus.FORBIDDEN);
  }
  static notFound(msg = 'یافت نشد.'): AppError {
    return new AppError('NOT_FOUND', msg, HttpStatus.NOT_FOUND);
  }
  static conflict(msg: string, code = 'CONFLICT'): AppError {
    return new AppError(code, msg, HttpStatus.CONFLICT);
  }
  static badRequest(msg: string, code = 'BAD_REQUEST'): AppError {
    return new AppError(code, msg, HttpStatus.BAD_REQUEST);
  }
}
