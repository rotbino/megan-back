import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { CategoriesService } from './categories.service';
import { ok } from '../common/api-response';

export class GetCategoriesByParentDto {
  /** null یا حذف = دسته‌های ریشه */
  @IsOptional()
  @IsInt()
  parent_id?: number | null;
}

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Post('getAllCategories')
  @ApiOperation({ summary: 'درخت کامل دسته‌بندی‌ها (کش سمت سرور)' })
  async getAllCategories() {
    return ok(await this.categories.getAllCategories());
  }

  @Post('getCategoriesByParent')
  @ApiOperation({ summary: 'فرزندان مستقیم یک دسته — parent_id=null برای ریشه‌ها' })
  async getCategoriesByParent(@Body() dto: GetCategoriesByParentDto) {
    return ok(await this.categories.getCategoriesByParent(dto.parent_id ?? null));
  }
}
