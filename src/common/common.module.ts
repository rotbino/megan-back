import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { CacheModule } from './cache/cache.module';

/** زیرساخت مشترک — Prisma + کش (سراسری‌اند، همه‌جا تزریق می‌شوند) */
@Module({
  imports: [PrismaModule, CacheModule],
  exports: [PrismaModule, CacheModule],
})
export class CommonModule {}
