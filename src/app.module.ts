import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { LocationsModule } from './locations/locations.module';
import { UploadsModule } from './uploads/uploads.module';
import { ProductsModule } from './products/products.module';

/**
 * ریشه API مگان — فقط ماژول‌های ویژگی؛ زیرساخت مشترک در CommonModule
 * (Prisma + کش). حد نرخ سراسری: ۳۰۰ درخواست/دقیقه/IP (کنترلر auth سخت‌تر).
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    CommonModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    LocationsModule,
    UploadsModule,
    ProductsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
