import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

/**
 * مطابق قرارداد باسکول: POST /get_category_list { parent_id?: number }
 * خروجی: { status: true, categories: [...] }
 */
export class CategoryListDto {
  @ApiPropertyOptional({ description: 'شناسه دسته والد؛ خالی = دسته‌های ریشه' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  parent_id?: number;
}
