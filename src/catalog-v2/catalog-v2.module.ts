import { Module } from '@nestjs/common';
import { AdsReportModule } from '../admin/ads-report/ads-report.module';
import { CategoriesModule } from '../categories/categories.module';
import { CatalogV2Controller } from './catalog-v2.controller';

/**
 * کاتالوگ عمومی v2 — فقط خواندنی و بدون احراز هویت.
 * منطق (درخت + لیست عمومی) در AdsReportService است و اینجا فقط لایهٔ
 * عمومی‌سازی است: فقط confirmed، بدون تلفن، بدون گره‌های ادمینی.
 */
@Module({
  imports: [AdsReportModule, CategoriesModule],
  controllers: [CatalogV2Controller],
})
export class CatalogV2Module {}
