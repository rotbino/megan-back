import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CategoryListDto } from './dto/category-list.dto';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** GET /api/v1/categories — درخت کامل دسته‌ها (کش‌شده) */
  @Get()
  @ApiOperation({ summary: 'درخت کامل دسته‌بندی‌ها (کش سمت سرور)' })
  async tree() {
    return { status: true, categories: await this.categories.tree() };
  }

  /** POST /api/v1/categories/list — سازگار با قرارداد get_category_list باسکول */
  @Post('list')
  @ApiOperation({ summary: 'فرزندان یک دسته (سازگار با باسکول: parent_id)' })
  async list(@Body() dto: CategoryListDto) {
    return {
      status: true,
      categories: await this.categories.children(dto.parent_id ?? null),
    };
  }
}
