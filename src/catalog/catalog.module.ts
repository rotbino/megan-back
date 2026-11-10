import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationsModule } from '../locations/locations.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

/** کاتالوگ کاربر — شخصی‌سازی صفحهٔ عمومی /c/{catalogId} (۱۰-۱۱ + دور ۲/۳) */
@Module({
  // AuthModule: JwtService را export می‌کند — گارد روش‌به‌روشِ کنترلر به آن
  // نیاز دارد (بدون آن خطای UnknownDependencies)؛ LocationsModule: نام شهرها
  // در دفترچهٔ ذخیره‌شده‌ها و لیست ذخیره‌کنندگان.
  imports: [AuthModule, LocationsModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
