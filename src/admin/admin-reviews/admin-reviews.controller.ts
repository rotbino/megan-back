import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { ok } from '../../common/api-response';
import { AdminReviewsService } from './admin-reviews.service';
import { DeleteReviewDto, GetReviewListDto } from './dto';

/** نظرات فروشندگان — خواندن/حذف از پنل ادمین (تسویه بدهی ممیزی). */
@ApiTags('admin/reviews')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly reviews: AdminReviewsService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('getReviewList')
  @ApiOperation({ summary: 'فهرست نظرات فروشندگان + آمار امتیاز' })
  async getReviewList(@Body() dto: GetReviewListDto) {
    return ok(await this.reviews.getReviewList(dto));
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('deleteReview')
  @ApiOperation({ summary: 'حذف یک نظر' })
  async deleteReview(@Body() dto: DeleteReviewDto) {
    return ok(await this.reviews.deleteReview(dto.id), 'نظر حذف شد.');
  }
}
