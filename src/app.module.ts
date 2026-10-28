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
import { VerificationModule } from './verification/verification.module';
import { BuyRequestsModule } from './buy-requests/buy-requests.module';
import { SavedModule } from './saved/saved.module';
import { ChatModule } from './chat/chat.module';
import { PresenceModule } from './presence/presence.module';
import { ReviewsModule } from './reviews/reviews.module';
import { CallsModule } from './calls/calls.module';
import { WalletModule } from './wallet/wallet.module';
import { PushModule } from './push/push.module';
import { AdminModule } from './admin/admin.module';

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
    VerificationModule,
    BuyRequestsModule,
    SavedModule,
    ChatModule,
    PresenceModule,
    ReviewsModule,
    CallsModule,
    WalletModule,
    PushModule,
    AdminModule, // پنل ادمین — کد کاملاً جدا در src/admin/
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
