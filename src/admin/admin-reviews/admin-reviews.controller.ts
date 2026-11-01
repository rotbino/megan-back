import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { ok } from '../../common/api-response';
import { AdminReviewsService } from './admin-reviews.service';
import { DeleteReviewDto, GetReviewListDto, SetReviewStatusDto } from './dto';

/** نظرات فروشندگان — خواندن/تأیید/رد/حذف از پنل ادمین. تأیید ادمین تنها راه
 *  عمومی شدن نظر است (قانون انتشار مالک ۲-۱۱: تحقیق → تأیید → انتشار). */
@ApiTags('admin/reviews')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly reviews: AdminReviewsService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('getReviewList')
  @ApiOperation({ summary: 'فهرست نظرات فروشندگان + آمار امتیاز (فیلتر وضعیت)' })
  async getReviewList(@Body() dto: GetReviewListDto) {
    return ok(await this.reviews.getReviewList(dto));
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('setReviewStatus')
  @ApiOperation({ summary: 'تأیید (approved) یا رد (rejected) یک نظر' })
  async setReviewStatus(@Body() dto: SetReviewStatusDto) {
    return ok(
      await this.reviews.setReviewStatus(dto.id, dto.status),
      dto.status === 'approved' ? 'نظر تأیید و منتشر شد.' : 'نظر رد شد.',
    );
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('deleteReview')
  @ApiOperation({ summary: 'حذف یک نظر' })
  async deleteReview(@Body() dto: DeleteReviewDto) {
    return ok(await this.reviews.deleteReview(dto.id), 'نظر حذف شد.');
  }
}
