import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CityMarketService } from './city-market.service';
import { GetCityMarketProductsDto } from './dto';
import { ok } from '../common/api-response';

/**
 * بازار عمدهٔ شهری — /city/{slug} (خواستهٔ مالک ۹-۱۱).
 * اندپوینت مستقل از products تا فیلتر چندشهری سرویس اصلی را کند/پیچیده نکند.
 */
@ApiTags('city-market')
@Throttle({ default: { limit: 90, ttl: 60_000 } })
@Controller('cityMarket')
export class CityMarketController {
  constructor(private readonly cityMarket: CityMarketService) {}

  @Post('getProducts')
  @ApiOperation({
    summary: 'لیست چندشهری بازار شهری — cityIds الزامی (fail-closed)؛ سورت عین لیست ملی',
  })
  async getProducts(@Body() dto: GetCityMarketProductsDto) {
    return ok(await this.cityMarket.getProducts(dto));
  }
}
