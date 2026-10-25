import 'reflect-metadata';
import dotenv from 'dotenv';
// .env باید برنده شود حتی اگر متغیری از قبل در محیط تعریف شده باشد
dotenv.config({ path: '.env', override: true });
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { AppModule } from './app.module';
import { ensureIndexes } from './db-indexes';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  // Fastify = سرعت بالاتر از Express (انتخاب معماری پروژه)
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, logger: false }),
  );
  const config = app.get(ConfigService);

  // ── پلاگین‌های Fastify: امنیت + CORS + فشرده‌سازی پاسخ (سرعت) ──
  await app.register(import('@fastify/helmet'), { contentSecurityPolicy: false });
  const origins = (config.get<string>('CORS_ORIGINS') ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  await app.register(import('@fastify/cors'), {
    origin: origins.includes('*') ? true : origins,
    credentials: true,
  });
  await app.register(import('@fastify/compress'));

  // ── اعتبارسنجی سراسری ورودی‌ها (DTO با class-validator) ──
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true, // ورودی ناشناس حذف می‌شود
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── شکل یکنواخت خطاها ──
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableShutdownHooks();

  // ── ایندکس‌های دیتابیس (idempotent) ──
  const connection = app.get<Connection>(getConnectionToken());
  await ensureIndexes(connection);

  // ── مستندات Swagger فقط با SWAGGER_ENABLED=true ──
  if ((config.get<string>('SWAGGER_ENABLED') ?? 'false') === 'true') {
    const document = new DocumentBuilder()
      .setTitle('Megan API — ایمچ')
      .setDescription('مارکت‌پلیس B2B عمده‌فروشی ایمچ — NestJS + Fastify + Mongoose')
      .setVersion('0.2')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, document));
  }

  const port = Number(config.get('PORT') ?? 4000);
  const host = config.get<string>('HOST') ?? '0.0.0.0';
  await app.listen({ port, host });
  new Logger('Bootstrap').log(
    `🚀 Megan API (Fastify + Mongoose) → http://${host}:${port} | Swagger: /docs | DB: ${connection.name}`,
  );
}

bootstrap();
