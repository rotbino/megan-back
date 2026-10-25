import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category } from './schemas';
import { CacheService } from '../common/cache.service';

const CACHE_TTL_MS = 10 * 60 * 1000; // دسته‌ها به‌ندرت تغییر می‌کنند

export interface CategoryNode {
  id: number;
  category_name: string;
  slug: string;
  kind: string;
  unit: string;
  min: number;
  example: string | null;
  parent_id: number | null;
  score: number;
  children: CategoryNode[];
}

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name) private readonly categoryModel: Model<Category>,
    private readonly cache: CacheService,
  ) {}

  /** POST /categories/getAllCategories — درخت کامل سه‌سطحی (کش‌شده) */
  async getAllCategories(): Promise<CategoryNode[]> {
    return this.cache.wrap('categories:tree', CACHE_TTL_MS, async () => {
      const all = await this.categoryModel.find().lean<Category[]>();
      const nodes = new Map<number, CategoryNode>();
      for (const c of all) {
        nodes.set(c._id as number, { ...this.toDto(c), children: [] });
      }
      const roots: CategoryNode[] = [];
      for (const node of nodes.values()) {
        const parent = node.parent_id != null ? nodes.get(node.parent_id) : undefined;
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      const sortByScore = (list: CategoryNode[]): void => {
        list.sort((a, b) => b.score - a.score);
        for (const n of list) sortByScore(n.children);
      };
      sortByScore(roots);
      return roots;
    });
  }

  /** POST /categories/getCategoriesByParent — فرزندان مستقیم یک نود (کش‌شده) */
  async getCategoriesByParent(parentId: number | null): Promise<CategoryNode[]> {
    return this.cache.wrap(`categories:children:${parentId}`, CACHE_TTL_MS, async () => {
      const list = await this.categoryModel
        .find({ parent_id: parentId ?? null })
        .sort({ score: -1 })
        .lean<Category[]>();
      return list.map((c) => ({ ...this.toDto(c), children: [] }));
    });
  }

  private toDto(c: Category): Omit<CategoryNode, 'children'> {
    return {
      id: c._id as number,
      category_name: c.category_name,
      slug: c.slug,
      kind: c.kind,
      unit: c.unit,
      min: c.min,
      example: c.example ?? null,
      parent_id: c.parent_id ?? null,
      score: c.score,
    };
  }
}
