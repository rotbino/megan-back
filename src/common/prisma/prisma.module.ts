import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * یک PrismaClient در هر پروسه — همه‌جا با DI تزریق می‌شود.
 *
 * onModuleInit بعد از $connect یک کوئری گرم‌کردن شلیک می‌کند: اولین findMany
 * پرایسما روی کلاستر شاردشده تا ~۲ ثانیه صرف کشف توپولوژی دارد — اگر این
 * هزینه به اولین درخواست کاربر منتقل شود صفحه اول «کندی شدید» حس می‌شود.
 * اینجا در بوت پرداخت می‌شود (الگوی imach-back).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    const t0 = Date.now();
    await this.$connect();
    try {
      await Promise.all([
        this.category.findMany({ select: { id: true }, take: 1 }),
        this.location.findMany({ select: { id: true }, take: 1 }),
        this.product.findMany({ select: { id: true }, take: 1 }),
        this.user.findMany({ select: { id: true }, take: 1 }),
        this.file.findMany({ select: { id: true }, take: 1 }),
      ]);
      this.logger.log(`Prisma connected + warmed in ${Date.now() - t0}ms`);
    } catch {
      /* گرم‌کردن بهترین‌حال است — خطایش بوت را نمی‌شکند */
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
