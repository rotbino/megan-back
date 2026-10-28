import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import {
  CreateProductDto,
  DeleteMyProductDto,
  GetMyProductDetailDto,
  GetProductByIdDto,
  GetProductListDto,
  GetRelatedProductsDto,
  GetSellerDto,
  GetSellerPhoneDto,
  SearchSuggestionsDto,
  UpdateMyProductDto,
} from './dto';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../common/guards';
import { CurrentUser, MaybeCurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';

@ApiTags('products')
/** حد نرخ ریزتر از سراسری — لیست/جزئیات + ثبت آگهی */
@Throttle({ default: { limit: 90, ttl: 60_000 } })
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post('getProductList')
  @ApiOperation({
    summary: 'لیست آگهی‌های عمومی — فیلتر دسته/استان/شهر/جستجو + سورت + صفحه‌بندی',
  })
  async getProductList(@Body() dto: GetProductListDto) {
    return ok(await this.products.getProductList(dto));
  }

  @Post('getProductById')
  @ApiOperation({ summary: 'جزئیات یک آگهی تاییدشده (عمومی)' })
  async getProductById(@Body() dto: GetProductByIdDto) {
    return ok(await this.products.getProductById(dto.id));
  }

  @Post('getRelatedProducts')
  @ApiOperation({ summary: 'محصولات مرتبط هم‌دسته (عین باسکول)' })
  async getRelatedProducts(@Body() dto: GetRelatedProductsDto) {
    return ok(await this.products.getRelatedProducts(dto.subCategoryId, dto.excludeId, dto.limit ?? 6));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('createProduct')
  @ApiOperation({ summary: 'ثبت آگهی از ویزارد ۶ مرحله‌ای → «در انتظار تایید»' })
  async createProduct(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return ok(await this.products.createProduct(user, dto), 'محصول شما با موفقیت ثبت شد.');
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMyProducts')
  @ApiOperation({ summary: 'آگهی‌های کاربر جاری + شمارنده تب‌ها + ظرفیت' })
  async getMyProducts(@CurrentUser() user: AuthUser) {
    return ok(await this.products.getMyProducts(user.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getMyProductDetail')
  @ApiOperation({ summary: 'جزئیات کامل آگهی خودم — پیش‌پر کردن فرم ویرایش' })
  async getMyProductDetail(@CurrentUser() user: AuthUser, @Body() dto: GetMyProductDetailDto) {
    return ok(await this.products.getMyProductDetail(user, dto.id));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('updateMyProduct')
  @ApiOperation({ summary: 'ویرایش آگهی خودم → دوباره «در انتظار تایید»' })
  async updateMyProduct(@CurrentUser() user: AuthUser, @Body() dto: UpdateMyProductDto) {
    return ok(await this.products.updateMyProduct(user, dto), 'تغییرات آگهی شما ذخیره شد و دوباره در انتظار تایید است.');
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('deleteMyProduct')
  @ApiOperation({ summary: 'حذف نرم آگهی (تب «حذف شده») — عین باسکول' })
  async deleteMyProduct(@CurrentUser() user: AuthUser, @Body() dto: DeleteMyProductDto) {
    return ok(await this.products.deleteMyProduct(user, dto.id), 'آگهی حذف شد.');
  }

  // بازبینی آگهی حالا فقط از مسیر ادمین انجام می‌شود:
  // POST /admin/products/reviewProduct (AdminJwtAuthGuard — فاز A4)

  @Post('getSeller')
  @ApiOperation({ summary: 'پروفایل عمومی فروشنده + آگهی‌های تاییدشده' })
  async getSeller(@Body() dto: GetSellerDto) {
    return ok(await this.products.getSeller(dto.userName));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('getSellerPhone')
  @ApiOperation({
    summary:
      'شماره تماس فروشنده (آگهی یا پروفایل) — نیاز به ورود (مدل lead-gen)؛ خریدار واردشده خودکار در گزارش تماس‌ها ثبت می‌شود',
  })
  async getSellerPhone(@CurrentUser() user: AuthUser, @Body() dto: GetSellerPhoneDto) {
    return ok(await this.products.getSellerPhone(user, dto));
  }

  @Post('searchSuggestions')
  @ApiOperation({ summary: 'پیشنهاد جستجوی زنده هدر (دسته‌ها + محصولات)' })
  async searchSuggestions(@Body() dto: SearchSuggestionsDto) {
    return ok(await this.products.searchSuggestions(dto.typedText));
  }
}
