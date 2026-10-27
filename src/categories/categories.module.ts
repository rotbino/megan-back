import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService], // ماژول محصولات برای denorm دسته استفاده می‌کند
})
export class CategoriesModule {}
