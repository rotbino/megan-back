import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService], // ماژول محصولات برای denorm مکان استفاده می‌کند
})
export class LocationsModule {}
