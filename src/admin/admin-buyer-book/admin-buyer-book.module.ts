import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { CategoriesModule } from '../../categories/categories.module';
import { AdminBuyerBookController } from './admin-buyer-book.controller';
import { AdminBuyerBookService } from './admin-buyer-book.service';

/**
 * مدیریت دفتر خرید (درخواست‌های خرید دوره‌ای) — پنل ادمین.
 * خواستهٔ مالک ۸-۱۱: بازبینی کالاهای دفتر خرید خریداران — ردیف تازه
 * «در انتظار تایید» است و دایرکتوری خریداران فقط تاییدشده‌ها را می‌بیند.
 */
@Module({
  imports: [AdminAuthModule, CategoriesModule],
  controllers: [AdminBuyerBookController],
  providers: [AdminBuyerBookService],
})
export class AdminBuyerBookModule {}
