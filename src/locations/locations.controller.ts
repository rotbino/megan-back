import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { LocationsService } from './locations.service';
import { ok } from '../common/api-response';

export class GetCitiesByProvinceDto {
  /** null یا حذف = همه شهرهای ایران */
  @IsOptional()
  @IsInt()
  province_id?: number | null;
}

@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Post('getAllProvinces')
  @ApiOperation({ summary: 'همه استان‌ها (کش سمت سرور)' })
  async getAllProvinces() {
    return ok(await this.locations.getAllProvinces());
  }

  @Post('getCitiesByProvince')
  @ApiOperation({ summary: 'شهرهای یک استان — بدون province_id همه شهرها' })
  async getCitiesByProvince(@Body() dto: GetCitiesByProvinceDto) {
    return ok(await this.locations.getCitiesByProvince(dto.province_id ?? null));
  }
}
