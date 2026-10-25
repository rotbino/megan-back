import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * گارد توکن — هدر `Authorization: Bearer <accessToken>`
 * در صورت معتبر بودن، userId و phone را روی request می‌گذارد (@CurrentUser).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequestWithUser>();
    const header: string | undefined = request.headers?.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        message: 'برای این عملیات ابتدا وارد حساب خود شوید.',
        code: 'AUTH_REQUIRED',
      });
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; phone: string }>(
        header.slice('Bearer '.length).trim(),
      );
      request.userId = payload.sub;
      request.phone = payload.phone;
      return true;
    } catch {
      throw new UnauthorizedException({
        message: 'نشست شما منقضی شده است؛ دوباره وارد شوید.',
        code: 'AUTH_EXPIRED',
      });
    }
  }
}

/** تایپ کمکی برای request تزئین‌شده توسط گارد */
export interface FastifyRequestWithUser {
  headers: Record<string, unknown> & { authorization?: string };
  userId?: string;
  phone?: string;
}
