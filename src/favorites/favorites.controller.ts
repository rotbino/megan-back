import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FavoritesService } from './favorites.service';
import { IsSellerSavedDto, ToggleProductFavoriteDto, ToggleSellerFavoriteDto } from './dto';
import { ok } from '../common/api-response';
import type { AuthUser } from '../common/guards';

/** علاقه‌مندی‌ها — نشان کردن آگهی + ذخیره صفحه فروشنده (همه نیاز به ورود) */
@ApiTags('favorites')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Post('toggleProduct')
  @ApiOperation({ summary: 'نشان/حذف نشان آگهی' })
  async toggleProduct(@CurrentUser() user: AuthUser, @Body() dto: ToggleProductFavoriteDto) {
    return ok(await this.favorites.toggleProduct(user, dto.productId));
  }

  @Post('toggleSeller')
  @ApiOperation({ summary: 'ذخیره/حذف صفحه اختصاصی فروشنده' })
  async toggleSeller(@CurrentUser() user: AuthUser, @Body() dto: ToggleSellerFavoriteDto) {
    return ok(await this.favorites.toggleSeller(user, dto.userName));
  }

  @Post('getMyProductFavoriteIds')
  @ApiOperation({ summary: 'شناسه آگهی‌های نشان‌شده من — وضعیت اولیه دکمه‌ها' })
  async getMyProductFavoriteIds(@CurrentUser() user: AuthUser) {
    return ok(await this.favorites.getMyProductFavoriteIds(user.id));
  }

  @Post('isSellerSaved')
  @ApiOperation({ summary: 'آیا این فروشنده را ذخیره کرده‌ام؟' })
  async isSellerSaved(@CurrentUser() user: AuthUser, @Body() dto: IsSellerSavedDto) {
    const saved = await this.favorites.isSellerSaved(user.id, dto.userName);
    return ok({ saved });
  }

  @Post('getMyFavorites')
  @ApiOperation({ summary: 'آگهی‌ها + فروشندگان ذخیره‌شده من' })
  async getMyFavorites(@CurrentUser() user: AuthUser) {
    return ok(await this.favorites.getMyFavorites(user.id));
  }
}
