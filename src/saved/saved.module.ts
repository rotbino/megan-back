import { Module } from '@nestjs/common';
import { SavedController } from './saved.controller';
import { SavedService } from './saved.service';
import { AuthModule } from '../auth/auth.module';

/** ماژول CRM نشان‌شده‌ها — B7 */
@Module({
  imports: [AuthModule],
  controllers: [SavedController],
  providers: [SavedService],
})
export class SavedModule {}
