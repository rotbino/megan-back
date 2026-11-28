import { Module } from '@nestjs/common';
import { AdsReportModule } from '../admin/ads-report/ads-report.module';
import { CategoriesModule } from '../categories/categories.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogV2Controller } from './catalog-v2.controller';

/**
 * کاتالوگ عمومی v2 — فقط خواندنی. منطق (درخت + لیست عمومی) در AdsReportService
 * است و اینجا فقط لایهٔ عمومی‌سازی است: فقط confirmed، بدون تلفن، بدون گره‌های
 * ادمینی. getList توکنِ اختیاری می‌گیرد (همان OptionalJwtAuthGuard) تا سورت
 * «مرتبط‌ترین» بتواند شهر خودِ کاربر را در امتیاز بیاورد — AuthModule برای
 * JwtServiceٔ گارد لازم است (۲۸-۱۱ دور ۳).
 */
@Module({
  imports: [AdsReportModule, CategoriesModule, AuthModule],
  controllers: [CatalogV2Controller],
})
export class CatalogV2Module {}
