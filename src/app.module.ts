import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CategoriesModule } from './categories/categories.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    PrismaModule,
    CategoriesModule,
    // فازهای بعدی:
    // AuthModule (OTP موبایل)، ProductsModule، BuyRequestsModule،
    // ChatModule (WebSocket)، PaymentsModule (پرداخت امن)
  ],
})
export class AppModule {}
