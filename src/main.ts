import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // Fastify = سرعت بالاتر از Express برای همین انتخاب شد
    new FastifyAdapter({ trustProxy: true }),
  );

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? '*').split(','),
    credentials: true,
  });

  await app.listen({ port: Number(process.env.PORT ?? 4000), host: '0.0.0.0' });
  console.log(`🚀 Megan API (Fastify) running on :${await app.getUrl()}`);
}

bootstrap();
