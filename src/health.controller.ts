import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ok } from './common/api-response';

/**
 * GET /health — تنها اندپوینت GET کل سرویس (برای مانیتورینگ آپ‌تایم).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  @ApiOperation({ summary: 'سلامت سرویس و اتصال دیتابیس' })
  check() {
    const dbUp = this.connection.readyState === 1;
    return ok({
      service: 'megan-back',
      db: dbUp ? 'up' : 'down',
      time: new Date().toISOString(),
    });
  }
}
