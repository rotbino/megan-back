import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { VerificationService } from './verification.service';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';

@ApiTags('verification')
/** حد نرخ ریزتر از سراسری — مدارک احراز — آپلود و بررسی */
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('submitVerification')
  @ApiOperation({
    summary: 'ارسال مدارک احراز هویت (multipart: nationalCard + selfie) → در حال بررسی',
  })
  async submitVerification(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest) {
    return ok(
      await this.verification.submit(user, req),
      'مدارک شما با موفقیت ارسال شد و در حال بررسی است.',
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMyVerification')
  @ApiOperation({ summary: 'وضعیت احراز هویت کاربر جاری + مدارک ارسالی' })
  async getMyVerification(@CurrentUser() user: AuthUser) {
    return ok(await this.verification.getMy(user.id));
  }

  // صف و بازبینی احراز حالا فقط از مسیر ادمین:
  // POST /admin/users/getVerificationOrders|reviewVerification (AdminJwtAuthGuard — فاز A3/A5)
}
