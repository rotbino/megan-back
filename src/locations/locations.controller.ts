import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { LocationsService } from './locations.service';
import { ok } from '../common/api-response';

class ProvinceDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  province_id?: number | null;
}

@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Post('getAllProvinces')
  @ApiOperation({ summary: 'همه استان‌ها (کش‌شده)' })
  async getAllProvinces() {
    return ok(await this.locations.getAllProvinces());
  }

  @Post('getCitiesByProvince')
  @ApiOperation({ summary: 'شهرهای یک استان (province_id=null → همه شهرها)' })
  async getCitiesByProvince(@Body() dto: ProvinceDto) {
    return ok(await this.locations.getCitiesByProvince(dto.province_id ?? null));
  }
}
