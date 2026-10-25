import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

/** ماژول سراسری — CacheService برای همه ماژول‌ها در دسترس است */
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CommonModule {}
