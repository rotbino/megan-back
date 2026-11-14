import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * یک PrismaClient در هر پروسه — همه‌جا با DI تزریق می‌شود.
 *
 * onModuleInit بعد از $connect یک کوئری گرم‌کردن شلیک می‌کند: اولین findMany
 * پرایسما روی کلاستر شاردشده تا ~۲ ثانیه صرف کشف توپولوژی دارد — اگر این
 * هزینه به اولین درخواست کاربر منتقل شود صفحه اول «کندی شدید» حس می‌شود.
 * اینجا در بوت پرداخت می‌شود (الگوی imach-back).
 *
 * اتصال/گرم‌کردن بهترین‌حال است: اگر دیتابیس پایین باشد (یا از شبکهٔ
 * سرورلس مثل ورسل در دسترس نباشد) بوت «نمی‌شکند» — /api/v1/health با
 * db:down جواب می‌دهد، کوئری‌های بعدی خودشان دوباره وصل می‌شوند. کرشِ
 * کل تابع serverless به‌خاطر دیتابیسِ موقتاً قطع، فقط همه‌چیز را می‌کشت.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    const t0 = Date.now();
    try {
      await this.$connect();
      await Promise.all([
        this.category.findMany({ select: { id: true }, take: 1 }),
        this.location.findMany({ select: { id: true }, take: 1 }),
        this.product.findMany({ select: { id: true }, take: 1 }),
        this.user.findMany({ select: { id: true }, take: 1 }),
        this.file.findMany({ select: { id: true }, take: 1 }),
      ]);
      this.logger.log(`Prisma connected + warmed in ${Date.now() - t0}ms`);
    } catch (err) {
      // console.error مستقیم (نه Logger نست) — در production لاگر Nest خاموش
      // است و این پیام باید در Runtime Logs ورسل دیده شود.
      console.error(
        `Prisma connect/warm در بوت شکست خورد — سرویس بالا می‌آید و اتصال به‌صورت تنبل تلاش می‌شود: ${err instanceof Error ? err.message : err}`,
      );
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
