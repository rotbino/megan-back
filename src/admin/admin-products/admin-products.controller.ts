import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminProductsService } from './admin-products.service';
import { ok } from '../../common/api-response';
import {
  GetAdminProductListDto,
  ProductIdDto,
  ReviewAdminProductDto,
  SetLadderDto,
  SetProductStatusDto,
} from './dto';

/**
 * فاز A4 — مدیریت آگهی‌ها (admin/products/*).
 * فقط POST JSON با قرارداد یکنواخت؛ همه محافظت‌شده با AdminJwtAuthGuard
 * (توکن کاربر عادی اینجا هرگز قبول نمی‌شود — راز جدا + scope='admin').
 */
@ApiTags('admin-products')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly products: AdminProductsService) {}

  @Post('getProductList')
  @ApiOperation({ summary: 'لیست آگهی‌ها — جستجو/فیلتر وضعیت-دسته-استان-فروشنده-نردبان + شمارنده تب‌ها' })
  async getProductList(@Body() dto: GetAdminProductListDto) {
    return ok(await this.products.getProductList(dto));
  }

  @Post('getProductDetail')
  @ApiOperation({ summary: 'جزئیات کامل آگهی + گالری + فروشنده + سفارش‌های نردبان (فقط خواندنی)' })
  async getProductDetail(@Body() dto: ProductIdDto) {
    return ok(await this.products.getProductDetail(dto.id));
  }

  @Post('reviewProduct')
  @ApiOperation({ summary: 'بازبینی آگهی در انتظار — تأیید یا رد با دلایل ساختاریافته' })
  async reviewProduct(@Body() dto: ReviewAdminProductDto) {
    return ok(
      await this.products.reviewProduct(dto),
      dto.approve ? 'آگهی تأیید شد.' : 'آگهی رد شد.',
    );
  }

  @Post('setProductStatus')
  @ApiOperation({ summary: 'تغییر مستقیم وضعیت — تأیید/رد/مخفی‌سازی/حذف نرم با پاک‌سازی فایل‌ها' })
  async setProductStatus(@Body() dto: SetProductStatusDto) {
    return ok(
      await this.products.setProductStatus(dto),
      dto.status === 'deleted'
        ? 'آگهی حذف و فایل‌هایش پاک شد.'
        : 'وضعیت آگهی تغییر کرد.',
    );
  }

  @Post('deleteProduct')
  @ApiOperation({ summary: 'حذف نرم آگهی + پاک‌سازی فایل‌های گالری از ذخیره‌سازی' })
  async deleteProduct(@Body() dto: ProductIdDto) {
    return ok(await this.products.deleteProduct(dto.id), 'آگهی حذف و فایل‌هایش پاک شد.');
  }

  @Post('setLadder')
  @ApiOperation({ summary: 'روشن/خاموش کردن نردبان — هدیه ۳۰ روزه (سفارش با مبلغ صفر) یا برچیدن' })
  async setLadder(@Body() dto: SetLadderDto) {
    return ok(
      await this.products.setLadder(dto),
      dto.active ? 'نردبان (جهش تبلیغاتی) فعال شد.' : 'نردبان آگهی برچیده شد.',
    );
  }
}
