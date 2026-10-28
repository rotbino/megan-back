import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class PresenceStatusDto {
  /** ObjectIdهای کاربران — برای کارت فروشنده/چت (id را از قبل دارد) */
  @ApiPropertyOptional({ type: [String], description: 'شناسه‌های کاربر (حداکثر ۵۰)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ids?: string[];

  /** شناسه‌های عمومی پروفایل — برای صفحات پروفایل/آگهی */
  @ApiPropertyOptional({ type: [String], description: 'user_name های کاربر (حداکثر ۵۰)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  userNames?: string[];
}

/** ورودی heartbeat ریز — بدنه خالی هم قبول است (توکن خودش کاربر را می‌رساند) */
export class PresenceHeartbeatDto {
  @ApiPropertyOptional({ description: 'نبض — بدنه خالی کافی است' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  ping?: string;
}
