import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import {
  CreateProductDto,
  DeleteMyProductDto,
  GetProductByIdDto,
  GetProductListDto,
  GetRelatedProductsDto,
  GetSellerDto,
  ReviewProductDto,
  SearchSuggestionsDto,
} from './dto';
import { AdminGuard, JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';

@ApiTags('products')
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
  @Post('deleteMyProduct')
  @ApiOperation({ summary: 'حذف نرم آگهی (تب «حذف شده») — عین باسکول' })
  async deleteMyProduct(@CurrentUser() user: AuthUser, @Body() dto: DeleteMyProductDto) {
    return ok(await this.products.deleteMyProduct(user, dto.id), 'آگهی حذف شد.');
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @Post('reviewProduct')
  @ApiOperation({ summary: '(ادمین) تأیید یا رد آگهی در انتظار' })
  async reviewProduct(@Body() dto: ReviewProductDto) {
    return ok(
      await this.products.reviewProduct(dto),
      dto.approve ? 'آگهی تایید شد.' : 'آگهی رد شد.',
    );
  }

  @Post('getSeller')
  @ApiOperation({ summary: 'پروفایل عمومی فروشنده + آگهی‌های تاییدشده' })
  async getSeller(@Body() dto: GetSellerDto) {
    return ok(await this.products.getSeller(dto.userName));
  }

  @Post('searchSuggestions')
  @ApiOperation({ summary: 'پیشنهاد جستجوی زنده هدر (دسته‌ها + محصولات)' })
  async searchSuggestions(@Body() dto: SearchSuggestionsDto) {
    return ok(await this.products.searchSuggestions(dto.typedText));
  }
}
