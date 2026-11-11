import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ServiceSignupsController } from './service-signups.controller';
import { ServiceSignupsService } from './service-signups.service';

/** ثبت‌نام سرویس‌های تخصصی ارزش‌افزوده (خواستهٔ مالک ۱۱-۱۲) */
@Module({
  // AuthModule: JwtModule/JwtService را export می‌کند — JwtAuthGuard به آن
  // برای امضای توکن نیاز دارد (الگوی همهٔ ماژول‌های گارددار).
  imports: [AuthModule],
  controllers: [ServiceSignupsController],
  providers: [ServiceSignupsService],
})
export class ServiceSignupsModule {}
