import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { SchemaFactory } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { OtpCode, RefreshToken } from './schemas';
import { User } from '../users/schemas';

/**
 * ماژول احراز هویت — کاملاً مستقل (مدل‌های لازم را خودش ثبت می‌کند)
 * تا JwtAuthGuard/JwtService بدون وابستگی چرخشی در دسترس UsersModule باشد.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          // قالب رشته‌ای ms مثل «7d» — تایپ template-literal است و از env قابل ارضا نیست
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '7d') as unknown as number,
        },
      }),
    }),
    MongooseModule.forFeature([
      { name: OtpCode.name, schema: SchemaFactory.createForClass(OtpCode) },
      { name: RefreshToken.name, schema: SchemaFactory.createForClass(RefreshToken) },
      { name: User.name, schema: SchemaFactory.createForClass(User) },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
