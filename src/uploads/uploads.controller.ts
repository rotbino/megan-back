import { Body, Controller, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/guards';
import { ok } from '../common/api-response';
import { AppError } from '../common/errors/app-error';
import { UploadsService, RELATED_MODELS, type RelatedModel } from './uploads.service';

class DeleteImageDto {
  @IsString()
  @Length(24, 24)
  fileId!: string;
}

class GetFileUrlDto {
  @IsString()
  @Length(1, 20)
  model!: string;

  @IsString()
  @Length(24, 24)
  modelId!: string;

  @IsString()
  @Length(1, 40)
  key!: string;
}

/**
 * ─── API فایل‌ها ───────────────────────────────────────────────────────────────
 *   POST /uploads/uploadImage?model=&modelId=&key=&description=&replace=  (auth, multipart)
 *   POST /uploads/getFileUrl   {model, modelId, key}                     (عمومی)
 *   POST /uploads/deleteImage  {fileId}                                  (auth)
 *   POST /uploads/listOrphans / deleteOrphans / getUsage                 (ادمین)
 *
 * آپلودها multipart/form-data با یک پارت `file` هستند. خواندن‌ها URL عمومی
 * مستقیم برمی‌گردانند — مرورگر بایت‌ها را مستقیم از آروان می‌گیرد (سریع).
 */
@ApiTags('uploads')
/** حد نرخ ریزتر از سراسری — آپلود — سنگین‌ترین مسیر */
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('uploads')
export class UploadsController {
  constructor(private readonly files: UploadsService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('uploadImage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'آپلود تصویر (jpeg/png/webp، ۵MB≥، ≥۲۰KB) → ردیف File + URL عمومی',
    description: 'query: model (User|Product), modelId?, key (avatar|gallery|…), description?, replace?',
  })
  async uploadImage(
    @Req() req: FastifyRequest,
    @Query('model') model: string,
    @Query('modelId') modelId: string | undefined,
    @Query('key') key: string | undefined,
    @Query('description') description: string | undefined,
    @Query('replace') replace: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!(RELATED_MODELS as readonly string[]).includes(model)) {
      throw AppError.badRequest('model باید User یا Product باشد.', 'BAD_MODEL');
    }
    const { fields, file } = await this.files.readMultipart(req);
    const fieldKey = key || fields.key;
    if (!fieldKey || fieldKey.length > 40 || !/^[a-zA-Z0-9_-]+$/.test(fieldKey)) {
      throw AppError.badRequest('key الزامی است (حروف، رقم، - و _).', 'BAD_KEY');
    }
    const replaceFlag = replace ?? fields.replace;
    const fileDto = await this.files.upload(
      user,
      {
        model: model as RelatedModel,
        modelId: modelId || fields.modelId || null,
        fieldKey,
        description: description ?? fields.description,
        replace: replaceFlag !== 'false' && replaceFlag !== '0',
      },
      file,
    );
    return ok(fileDto, 'تصویر با موفقیت آپلود شد.');
  }

  @Post('getFileUrl')
  @ApiOperation({ summary: 'آخرین فایل یک اسلات (عمومی)' })
  async getFileUrl(@Body() dto: GetFileUrlDto) {
    return ok(await this.files.getFileUrl(dto.model, dto.modelId, dto.key));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('deleteImage')
  @ApiOperation({ summary: 'حذف فایل (بایت + ردیف) — مالک یا ادمین' })
  async deleteImage(@CurrentUser() user: AuthUser, @Body() dto: DeleteImageDto) {
    return ok(await this.files.remove(user, dto.fileId), 'فایل حذف شد.');
  }

  // نگهداشت فایل (عروسک‌ها/مصرف) حالا فقط از مسیر ادمین:
  // POST /admin/uploads/listOrphans|deleteOrphans|getUsage (AdminJwtAuthGuard — فاز A5)
}
