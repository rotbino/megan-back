import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { LocationsService } from './locations.service';
import { ok } from '../common/api-response';

class ProvinceDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  province_id?: number | null;
}

class ParentDto {
  @IsString()
  parent_id: string; // کلید ترکیبی درخت: «province:4» | «city:230» | …
}

class TopCitiesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@ApiTags('locations')
/** حد نرخ ریزتر از سراسری — استان/شهر — کش‌شده و سبک */
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Post('getAllProvinces')
  @ApiOperation({ summary: 'همه استان‌ها (کش‌شده) — از درخت لوکیشن واحد' })
  async getAllProvinces() {
    return ok(await this.locations.getAllProvinces());
  }

  @Post('getCitiesByProvince')
  @ApiOperation({ summary: 'شهرهای یک استان (province_id=null → همه شهرها)' })
  async getCitiesByProvince(@Body() dto: ProvinceDto) {
    return ok(await this.locations.getCitiesByProvince(dto.province_id ?? null));
  }

  @Post('getLocationsByParent')
  @ApiOperation({
    summary:
      'فرزندان مستقیم یک گره — عمومی برای سطح‌های آینده (منطقه/محله)؛ parent_id کلید ترکیبی مثل «province:4»',
  })
  async getLocationsByParent(@Body() dto: ParentDto) {
    return ok(await this.locations.getLocationsByParent(dto.parent_id));
  }

  @Post('getTopCities')
  @ApiOperation({
    summary: 'شهرهای پربازار به تعداد آگهی عمومی (نزولی) — باکس «بازار عمده شهرها» صفحهٔ اول',
  })
  async getTopCities(@Body() dto: TopCitiesDto) {
    return ok(await this.locations.getTopCities(dto.limit ?? 50));
  }
}
