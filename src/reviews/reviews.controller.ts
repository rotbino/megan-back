import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OptionalJwtAuthGuard, type AuthUser } from '../common/guards';
import { CurrentUser, MaybeCurrentUser } from '../common/decorators/current-user.decorator';
import { ok } from '../common/api-response';
import { ReviewsService } from './reviews.service';
import { AddSellerReviewDto, GetSellerReviewsDto } from './dto';

/**
 * نظرات کاربران درباره فروشنده — خواندن عمومی (مهمان هم می‌بیند)،
 * نوشتن با توکن. حد نرخ نوشتن پایین تا اسپم نظراتِ رقبا به‌سادگی ممکن نشود.
 */
@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('getSellerReviews')
  @ApiOperation({ summary: 'نظرات فروشنده + خلاصه امتیاز (عمومی، نظر من اگر لاگین)' })
  async getSellerReviews(@MaybeCurrentUser() user: AuthUser | null, @Body() dto: GetSellerReviewsDto) {
    return ok(await this.reviews.getSellerReviews(user?.id ?? null, dto));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // ثبت/ویرایش نظر محدود
  @Post('addSellerReview')
  @ApiOperation({ summary: 'ثبت/ویرایش نظر من درباره فروشنده (upsert)' })
  async addSellerReview(@CurrentUser() user: AuthUser, @Body() dto: AddSellerReviewDto) {
    return ok(await this.reviews.addSellerReview(user.id, dto), 'نظر شما ثبت شد.');
  }
}
