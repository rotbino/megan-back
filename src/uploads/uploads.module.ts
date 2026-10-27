import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { AuthModule } from '../auth/auth.module';

/** ماژول آپلود تصاویر — درایور ArvanCloud + جدول File چندریختی (R3) */
@Module({
  imports: [AuthModule], // برای JwtAuthGuard/JwtService
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService], // ماژول محصولات برای galleryMap استفاده می‌کند
})
export class UploadsModule {}
