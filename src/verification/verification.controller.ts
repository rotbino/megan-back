import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { VerificationService } from './verification.service';
import { GetVerificationOrdersDto, ReviewVerificationDto } from './dto';
import { AdminGuard, JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';

@ApiTags('verification')
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

  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @Post('getVerificationOrders')
  @ApiOperation({ summary: '(ادمین) صف بررسی درخواست‌های احراز هویت' })
  async getVerificationOrders(@Body() dto: GetVerificationOrdersDto) {
    return ok(await this.verification.listOrders(dto));
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @Post('reviewVerification')
  @ApiOperation({ summary: '(ادمین) تأیید یا رد درخواست با دلیل' })
  async reviewVerification(@CurrentUser() user: AuthUser, @Body() dto: ReviewVerificationDto) {
    return ok(
      await this.verification.review(user, dto),
      dto.approve ? 'هویت کاربر تأیید شد.' : 'درخواست رد شد.',
    );
  }
}
