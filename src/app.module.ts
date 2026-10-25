import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from './common/common.module';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { LocationsModule } from './locations/locations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // اتصال به MongoDB Atlas — ایندکس‌سازی خودکار خاموش (ایندکس‌ها صریحاً در db-indexes.ts ساخته می‌شوند)
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('DATABASE_URL'),
        autoIndex: false,
      }),
    }),
    CommonModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    LocationsModule,
  ],
  // HealthController اینجا است تا @InjectConnection بدون import اضافه کار کند
  controllers: [HealthController],
})
export class AppModule {}
