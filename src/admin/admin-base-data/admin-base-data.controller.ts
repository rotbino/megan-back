import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminBaseDataService } from './admin-base-data.service';
import { ok } from '../../common/api-response';
import {
  DeleteCategoryDto,
  DeleteGoodDto,
  GetGoodsDto,
  SetLocationActiveDto,
  UpsertCategoryDto,
  UpsertLocationDto,
} from './dto';

/**
 * فاز A2 — مدیریت اطلاعات پایه (دسته‌بندی‌ها + استان/شهر).
 * فقط POST JSON با قرارداد یکنواخت؛ همه محافظت‌شده با AdminJwtAuthGuard.
 */
@ApiTags('admin-base-data')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/base-data')
export class AdminBaseDataController {
  constructor(private readonly baseData: AdminBaseDataService) {}

  // ─── دسته‌بندی‌ها ──────────────────────────────────────────────────────────

  @Post('getCategoryTree')
  @ApiOperation({ summary: 'درخت دسته‌ها با شمارش فرزند/آگهی/درخواست' })
  async getCategoryTree() {
    return ok(await this.baseData.getCategoryTree());
  }

  @Post('upsertCategory')
  @ApiOperation({ summary: 'ایجاد/ویرایش دسته (نام، واحد، حداقل، نمونه، امتیاز، والد)' })
  async upsertCategory(@Body() dto: UpsertCategoryDto) {
    return ok(await this.baseData.upsertCategory(dto));
  }

  @Post('deleteCategory')
  @ApiOperation({ summary: 'حذف دسته — فقط بدون فرزند و بدون ارجاع' })
  async deleteCategory(@Body() dto: DeleteCategoryDto) {
    return ok(await this.baseData.deleteCategory(dto.id));
  }

  // ─── انواع کالا (Good) ──────────────────────────────────────────────

  @Post('getGoods')
  @ApiOperation({ summary: 'انواع کالا (ورودی آزاد کاربران) با مسیر دسته و شمارنده‌ها' })
  async getGoods(@Body() dto: GetGoodsDto) {
    return ok(await this.baseData.getGoods(dto));
  }

  @Post('deleteGood')
  @ApiOperation({ summary: 'حذف نوع کالا — فقط بدون ارجاع درخواست' })
  async deleteGood(@Body() dto: DeleteGoodDto) {
    return ok(await this.baseData.deleteGood(dto.id));
  }

  // ─── مکان‌ها ───────────────────────────────────────────────────────────────

  @Post('getLocations')
  @ApiOperation({ summary: 'استان‌ها و شهرها + وضعیت فعال + شمارش ارجاع' })
  async getLocations(@Body() dto: { provinceId?: number }) {
    return ok(await this.baseData.getLocations(dto?.provinceId));
  }

  @Post('upsertLocation')
  @ApiOperation({ summary: 'ایجاد/ویرایش استان یا شهر' })
  async upsertLocation(@Body() dto: UpsertLocationDto) {
    return ok(await this.baseData.upsertLocation(dto));
  }

  @Post('setLocationActive')
  @ApiOperation({ summary: 'فعال/غیرفعال کردن مکان (غیرفعال = پنهان از لیست‌ها)' })
  async setLocationActive(@Body() dto: SetLocationActiveDto) {
    return ok(await this.baseData.setLocationActive(dto.buskolId, dto.type, dto.active));
  }
}
