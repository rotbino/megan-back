import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/** تسک‌های کاربر — «کارهای مهم من» (زنگولهٔ اعلان فرانت، خواستهٔ مالک ۱۱-۱۱ دور ۴) */
@Module({
  // AuthModule: JwtModule/JwtService را export می‌کند — JwtAuthGuard به آن
  // برای امضای توکن نیاز دارد (الگوی همهٔ ماژول‌های گارددار).
  imports: [AuthModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
