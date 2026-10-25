import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService, TTL } from '../common/cache/cache.module';

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
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** POST /categories/getAllCategories — درخت کامل سه‌سطحی (کش‌شده) */
  async getAllCategories(): Promise<CategoryNode[]> {
    return this.cache.wrap(
      'categories:tree',
      { ttlMs: 10 * TTL.MINUTE, tags: ['base', 'categories'] },
      async () => {
        const all = await this.prisma.category.findMany({
          orderBy: { score: 'desc' },
        });
        const nodes = new Map<number, CategoryNode>();
        for (const c of all) {
          nodes.set(c.id, { ...this.toDto(c), children: [] });
        }
        const roots: CategoryNode[] = [];
        for (const node of nodes.values()) {
          const parent = node.parent_id != null ? nodes.get(node.parent_id) : undefined;
          if (parent) parent.children.push(node);
          else roots.push(node);
        }
        // findMany با orderBy score انجام شد → فرزندان هم به‌ترتیب score هستند
        return roots;
      },
    );
  }

  /** POST /categories/getCategoriesByParent — فرزندان مستقیم یک نود (کش‌شده) */
  async getCategoriesByParent(parentId: number | null): Promise<CategoryNode[]> {
    return this.cache.wrap(
      `categories:children:${parentId}`,
      { ttlMs: 10 * TTL.MINUTE, tags: ['base', 'categories'] },
      async () => {
        const list = await this.prisma.category.findMany({
          where: { parentId: parentId ?? null },
          orderBy: { score: 'desc' },
        });
        return list.map((c) => ({ ...this.toDto(c), children: [] }));
      },
    );
  }

  /** یافتن یک دسته در کش — برای denorm هنگام ثبت محصول */
  async getCategoryById(id: number): Promise<CategoryNode | null> {
    const all = await this.getAllCategories(); // کش‌شده
    const find = (nodes: CategoryNode[]): CategoryNode | null => {
      for (const n of nodes) {
        if (n.id === id) return n;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return find(all);
  }

  /** id یک دسته + همه فرزندانش (سه سطح) — برای فیلتر لیست با in */
  async getSubtreeIds(idOrSlug: number | string): Promise<number[]> {
    const all = await this.getAllCategories(); // کش‌شده
    let target: CategoryNode | undefined;
    const find = (nodes: CategoryNode[]): CategoryNode | undefined => {
      for (const n of nodes) {
        if (n.id === idOrSlug || n.slug === idOrSlug || n.category_name === idOrSlug) {
          target = n;
          return n;
        }
        const hit = find(n.children);
        if (hit) return hit;
      }
      return undefined;
    };
    find(all);
    if (!target) return [];
    const ids: number[] = [target.id];
    const collect = (n: CategoryNode): void => {
      for (const c of n.children) {
        ids.push(c.id);
        collect(c);
      }
    };
    collect(target);
    return ids;
  }

  private toDto(c: {
    id: number;
    categoryName: string;
    slug: string;
    kind: string;
    unit: string;
    min: number;
    example: string | null;
    parentId: number | null;
    score: number;
  }): Omit<CategoryNode, 'children'> {
    return {
      id: c.id,
      category_name: c.categoryName,
      slug: c.slug,
      kind: c.kind,
      unit: c.unit,
      min: c.min,
      example: c.example ?? null,
      parent_id: c.parentId ?? null,
      score: c.score,
    };
  }
}
