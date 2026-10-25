import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { CategoriesService } from './categories.service';
import { ok } from '../common/api-response';

class ParentDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  parent_id?: number | null;
}

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Post('getAllCategories')
  @ApiOperation({ summary: 'درخت کامل دسته‌ها (سه‌سطحی، کش‌شده)' })
  async getAllCategories() {
    return ok(await this.categories.getAllCategories());
  }

  @Post('getCategoriesByParent')
  @ApiOperation({ summary: 'فرزندان مستقیم یک دسته (parent_id=null → ریشه‌ها)' })
  async getCategoriesByParent(@Body() dto: ParentDto) {
    return ok(await this.categories.getCategoriesByParent(dto.parent_id ?? null));
  }
}
