import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyCompress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import fastifyIO from 'fastify-socket.io';
import path from 'node:path';
import { AppModule } from './app.module';
import { ChatModule } from './chat/chat.module';
import { ChatService } from './chat/chat.service';
import { PresenceModule } from './presence/presence.module';
import { PresenceService } from './presence/presence.service';
import { env, isProd, storage } from './common/config/env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { setIo } from './chat/io-holder';

const API_PREFIX = 'api/v1';

/** شناسه درخواست — از پروکسی یا تولیدشده؛ همه لاگ‌های همان درخواست را به هم می‌دوزد */
function genReqId(req: import('fastify').FastifyRequest): string {
  const incoming = req.headers['x-request-id'];
  return (typeof incoming === 'string' && incoming.slice(0, 64)) || `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    trustProxy: true, // پشت reverse proxy — برای rate limit بر پایه IP واقعی
    // آپلود multipart به فضای بیشتری از MAX_FILE_SIZE نیاز دارد
    bodyLimit: Math.max(512 * 1024, storage.MAX_FILE_SIZE + 1024 * 1024),
    // لاگ ساختاریافته pino — JSON در پروداکشن (قابل جمع‌آوری با Loki/ELK)،
    // در توسعه فقط هشدارها تا کنسول شلوغ نشود
    logger: {
      level: isProd ? 'info' : 'warn',
      genReqId,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
        ],
        censor: '[REDACTED]',
      },
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    // لاگ‌های Nest از طریق فیلتر/سکوت — لاگ HTTP ساختاریافته را pino فستیفای می‌دهد
    logger: isProd ? false : ['error', 'warn', 'log'],
  });

  // ── امنیت و پلتفرم ──────────────────────────────────────────────────────────
  // CORP = cross-origin: عکس‌های عمومی (آروان) از دامنه‌ی دیگری سرو می‌شوند؛
  // same-origin پیش‌فرضِ helmet آن‌ها را در مرورگر بلاک می‌کند (عکس «شکسته» دیده می‌شد)
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(fastifyMultipart, {
    // files:2 برای مدارک احراز هویت (کارت ملی + سلفی در یک درخواست)؛
    // سرویس‌های تک‌فایلی پارت اضافه را خودشان می‌بلعند (readMultipart)
    limits: { fileSize: storage.MAX_FILE_SIZE, files: 2, fields: 10 },
  });
  await app.register(fastifyCompress);

  // ── چت لحظه‌ای (B8): socket.io روی همان پورت Fastify ───────────────────
  // احراز هویت handshake با توکن JWT (query: token — سوکت‌ها هدر سفارشی
  // راحت نمی‌فرستند)؛ کاربر به اتاق شخصی‌اش user:{id} می‌پیوندد.
  await app.register(fastifyIO, {
    cors: {
      origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((o) => o.trim()),
      credentials: true,
    },
  });

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

  // اتصال io به نگهدارنده + منطق handshake — بعد از listen (سرور آماده است)
  // (fastify-socket.io نمونه io را روی instance تزئین می‌کند — typing ندارد)
  const fastify = app.getHttpAdapter().getInstance() as
    import('fastify').FastifyInstance & { io?: import('socket.io').Server };
  if (fastify?.io) {
    setIo(fastify.io);
    const chat = app.select(ChatModule).get(ChatService, { strict: false });
    const presence = app.select(PresenceModule).get(PresenceService, { strict: false });
    const io = fastify.io;
    io.on('connection', async (socket) => {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.query?.token as string | undefined) ??
        (socket.handshake.headers?.authorization?.startsWith('Bearer ')
          ? socket.handshake.headers.authorization.slice(7)
          : undefined);
      const userId = token ? await chat.verifySocketToken(token) : null;
      if (!userId) {
        socket.disconnect(true);
        return;
      }
      socket.data.userId = userId;
      await socket.join(`user:${userId}`);
      // حضور: اتصال WS خودش یک نبض است — و قطع آن هم (grace ۹۰s باقی می‌ماند
      // تا ناوبری بین صفحات کاربر را ناگهانی آفلاین نکند)
      presence?.touch(userId);
      socket.on('disconnect', () => {
        presence?.touch(userId);
      });
    });
  }

  if (!isProd) console.log(`🚀 Megan API (Prisma + Fastify) → http://${env.HOST}:${env.PORT} | Swagger: /docs`);
}

void bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
