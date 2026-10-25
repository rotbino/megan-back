import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyCompress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { AppModule } from './app.module';
import { env, isProd, storage } from './common/config/env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

const API_PREFIX = 'api/v1';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    trustProxy: true, // پشت reverse proxy
    // آپلود multipart به فضای بیشتری از MAX_FILE_SIZE نیاز دارد
    bodyLimit: Math.max(512 * 1024, storage.MAX_FILE_SIZE + 1024 * 1024),
    logger: isProd
      ? false
      : {
          level: 'warn',
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie'],
            censor: '[REDACTED]',
          },
        },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: isProd ? ['error', 'warn'] : undefined,
  });

  // ── امنیت و پلتفرم ──────────────────────────────────────────────────────────
  // CORP = cross-origin: عکس‌های عمومی (آروان) از دامنه‌ی دیگری سرو می‌شوند؛
  // same-origin پیش‌فرضِ helmet آن‌ها را در مرورگر بلاک می‌کند (عکس «شکسته» دیده می‌شد)
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(fastifyMultipart, {
    limits: { fileSize: storage.MAX_FILE_SIZE, files: 1, fields: 10 },
  });
  await app.register(fastifyCompress);

  // درایور local فایل‌ها را مستقیم سرو می‌کند (درایور arvan بی‌اعتناست)
  if (storage.DRIVER === 'local') {
    await app.register(fastifyStatic, {
      root: path.resolve(storage.UPLOAD_PATH),
      prefix: '/uploads/',
    });
  }

  await app.register(import('@fastify/cors'), {
    origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  });

  // ── اعتبارسنجی و شکل خطا ────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // ورودی ناشناس حذف می‌شود
      transform: true, // تبدیل @Type() برای کوئری‌های عددی
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  // ── مستندات Swagger (در پروداکشن خاموش) ────────────────────────────────────
  if (env.SWAGGER_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle('Megan API — ایمچ')
      .setDescription('مارکت‌پلیس B2B عمده‌فروشی ایمچ — NestJS + Fastify + Prisma + MongoDB')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }

  await app.listen({ port: env.PORT, host: env.HOST });
  if (!isProd) console.log(`🚀 Megan API (Prisma + Fastify) → http://${env.HOST}:${env.PORT} | Swagger: /docs`);
}

void bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
