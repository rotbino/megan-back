import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationsModule } from '../locations/locations.module';
import { BuyerBookController } from './buyer-book.controller';
import { BuyerBookService } from './buyer-book.service';

/** دفتر خرید — صفحهٔ عمومی /b/{bookId} + ذخیرهٔ فروشنده‌ها (۱۰-۱۱ دور ۵) */
@Module({
  // AuthModule: JwtService را export می‌کند — گارد روش‌به‌روشِ کنترلر به آن
  // نیاز دارد (بدون آن خطای UnknownDependencies)؛ LocationsModule: نام
  // استان/شهر در کارت هویت خریدار و لیست ذخیره‌شده‌ها.
  imports: [AuthModule, LocationsModule],
  controllers: [BuyerBookController],
  providers: [BuyerBookService],
  exports: [BuyerBookService],
})
export class BuyerBookModule {}
