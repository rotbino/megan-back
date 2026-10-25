import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from './common/prisma/prisma.module';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'سلامت سرویس + وضعیت دیتابیس (تنها اندپوینت GET)' })
  async health() {
    let db: 'up' | 'down' = 'down';
    try {
      await this.prisma.category.findMany({ select: { id: true }, take: 1 });
      db = 'up';
    } catch {
      /* پایین است */
    }
    return { status: true, data: { service: 'megan-back', db, time: new Date().toISOString() } };
  }
}
