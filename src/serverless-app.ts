/**
 * ورودی serverless برای استقرار روی ورسل (Vercel) — همان AppModule، همان
 * Fastify، بدون listen (خواستهٔ مالک ۱۴-۱۱: بک روی megan-back.vercel.app).
 *
 * چرا این فایل جدا از main.ts است؟
 *   • main.ts سرور طولانی‌عمر است: app.listen + fastify-socket.io (چت WS) —
 *     هیچ‌کدام در تابع serverless معنا ندارد (ورسل WS و گوش‌دادن به پورت
 *     را پشتیبانی نمی‌کند).
 *   • این‌جا همان زنجیرهٔ Fastify (helmet/multipart/cors + ValidationPipe +
 *     AllExceptionsFilter + پیشوند api/v1) بدون socket.io و بدون
 *     fastify-static ساخته می‌شود؛ خودِ تابع ورسل (api/[...path].js)
 *     درخواست‌های خام Node را با fastify.routing(req, res) به همین
 *     نمونه می‌رساند — مسیر رسمی Fastify برای هندلر خام (instance.d.ts).
 *
 * تنزل تدریجی روی ورسل (قابل قبول برای API عمومی):
 *   • چت لحظه‌ای WS نیست — io-holder از قبل null-safe است؛ چت با REST
 *     کار می‌کند و emitToUser عملاً no-op می‌شود.
 *   • آینهٔ لوکال فایل‌ها روی ورسل خاموش است (env.ts: MIRROR_LOCAL در
 *     محیط VERCEL پیش‌فرض false — دیسک فقط-خواندنی است)؛ آپلود مستقیم
 *     روی آروان می‌نشیند.
 *   • جاب‌های ایمپورتر درون‌حافظه‌ای روی ورسل قابل‌اتکا نیستند — پنل
 *     ایمپورت مخصوص اجرای لوکال/سرور اختصاصی است.
 *
 * بیلد: nest build این فایل را هم به dist/serverless-app.js کامپایل می‌کند
 * (tsc واقعی → متادیتای دیکوریتورها سالم؛ esbuildِ بیلدر ورسل آن را
 * نمی‌سازد و DI نست می‌شکست — برای همین تابع از dist لود می‌شود، نه src).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyCors from '@fastify/cors';
import { AppModule } from './app.module';
import { env, storage } from './common/config/env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

const API_PREFIX = 'api/v1';

async function createFastify(): Promise<import('fastify').FastifyInstance> {
  const adapter = new FastifyAdapter({
    trustProxy: true, // پشت CDN ورسل — برای rate limit بر پایه IP واقعی
    // همان سقف main.ts — مدارک احراز هویت تا ۴ فایل در یک درخواست
    bodyLimit: Math.max(1024 * 1024, storage.MAX_FILE_SIZE * 4 + 2 * 1024 * 1024),
    // لاگ HTTP به STDOUT تابع ورسل — قابل مشاهده در لاگ‌های پروژه
    logger: true,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: false,
  });

  // ── همان امنیت/پلتفرم main.ts (بدون compress — لبهٔ ورسل خودش فشرده می‌کند) ──
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(fastifyMultipart, {
    limits: { fileSize: storage.MAX_FILE_SIZE, files: 4, fields: 20 },
  });
  await app.register(fastifyCors, {
    origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix(API_PREFIX);

  // Swagger — روی ورسل NODE_ENV=production است؛ فقط با opt-in صریح
  if (env.SWAGGER_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle('Megan API — ایمچ')
      .setDescription('مارکت‌پلیس B2B عمده‌فروشی ایمچ — NestJS + Fastify + Prisma + MongoDB')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }

  await app.init();
  const fastify = app.getHttpAdapter().getInstance() as import('fastify').FastifyInstance;
  await fastify.ready();
  return fastify;
}

/** پرامیس واحد — بین فراخوانی‌های تابع (نمونهٔ گرم) زنده می‌ماند.
 *  catch صرفاً برای جلوگیری از unhandledRejection هنگام require است؛
 *  خطای واقعی در handler تابع (api/[...path].js) خوانده و گزارش می‌شود. */
const readyPromise = createFastify();
readyPromise.catch(() => undefined);

export const ready: Promise<import('fastify').FastifyInstance> = readyPromise;
