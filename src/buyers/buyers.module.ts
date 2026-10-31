import { Module } from '@nestjs/common';
import { BuyersController } from './buyers.controller';
import { BuyersService } from './buyers.service';
import { AuthModule } from '../auth/auth.module';
import { PushModule } from '../push/push.module';
import { CategoriesModule } from '../categories/categories.module';

/** ماژول خریداران — دفتر خرید + دایرکتوری + پیشنهاد تامین (SiteSettingsModule
 *  سراسری است و هزینه‌ها را بدون import فراهم می‌کند؛ CategoriesModule برای
 *  فیلتر درختی دسته در دایرکتوری). */
@Module({
  imports: [AuthModule, PushModule, CategoriesModule],
  controllers: [BuyersController],
  providers: [BuyersService],
  exports: [BuyersService],
})
export class BuyersModule {}
