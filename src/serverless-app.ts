/**
 * ورودی serverless برای ورسل — بدون listen و بدون socket.io.
 *
 * چرا جدا از main.ts؟ روی ورسل تابع هیچ پورت/سوکتی ندارد؛ درخواست‌ها از
 * api/index.js با fastify.inject (light-my-request) به همین اپ تزریق
 * می‌شوند. وب‌سوکت از پروکسی ورسل عبور نمی‌کند، پس fastify-socket.io هم
 * اینجا ثبت نمی‌شود (REST چت مثل قبل کار می‌کند).
 *
 * درایور فایل روی ورسل همیشه arvan است (env.ts دیسک readonly را قفل
 * می‌کند) — پس fastify-static لازم نیست.
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyCompress from '@fastify/compress';
import { AppModule } from './app.module';
import { env, isProd, storage } from './common/config/env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

const API_PREFIX = 'api/v1';

function genReqId(req: import('fastify').FastifyRequest): string {
  const incoming = req.headers['x-request-id'];
  return (
    (typeof incoming === 'string' && incoming.slice(0, 64)) ||
    `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  );
}

async function buildApp(): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    trustProxy: true,
    bodyLimit: Math.max(1024 * 1024, storage.MAX_FILE_SIZE * 4 + 2 * 1024 * 1024),
    logger: {
      level: isProd ? 'info' : 'warn',
      genReqId,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '[REDACTED]',
      },
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: isProd ? false : ['error', 'warn', 'log'],
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(fastifyMultipart, {
    limits: { fileSize: storage.MAX_FILE_SIZE, files: 4, fields: 20 },
  });
  await app.register(fastifyCompress);
  await app.register(import('@fastify/cors'), {
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
  app.enableShutdownHooks();

  await app.init(); // مثل listen ولی بدون پورت — آمادهٔ inject
  return app;
}

let cached: Promise<NestFastifyApplication> | null = null;

/** نمونهٔ اپ — در هر پروسه یک‌بار ساخته و برای همهٔ درخواست‌ها کش می‌شود */
export function getApp(): Promise<NestFastifyApplication> {
  if (!cached) {
    cached = buildApp().catch((err) => {
      cached = null; // شکست خورد؟ فراخوانی بعدی از نو تلاش می‌کند
      throw err;
    });
  }
  return cached;
}
