import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PackagesModule } from '../../packages/packages.module';
import { AdminPackagesController } from './admin-packages.controller';
import { AdminPackagesService } from './admin-packages.service';

/** فاز بسته‌ها — صف بازبینی فیش‌های خرید بسته (admin/packages/*) */
@Module({
  imports: [AdminAuthModule, PackagesModule],
  controllers: [AdminPackagesController],
  providers: [AdminPackagesService],
})
export class AdminPackagesModule {}
