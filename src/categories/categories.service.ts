import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../common/cache.service';

const TREE_TTL_MS = 10 * 60 * 1000; // ۱۰ دقیقه — دسته‌بندی‌ها به‌ندرت تغییر می‌کنند

@Injectable()
export class CategoriesService {
  constructor(
    private readonly db: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** درخت کامل سه‌سطحی: کشاورزی ← خشکبار ← پسته */
  tree() {
    return this.cache.wrap('categories:tree', TREE_TTL_MS, () =>
      this.db.category.findMany({
        where: { parentId: null },
        orderBy: { score: 'desc' },
        include: {
          children: {
            orderBy: { score: 'desc' },
            include: { children: { orderBy: { score: 'desc' } } },
          },
        },
      }),
    );
  }

  children(parentId: number | null) {
    return this.cache.wrap(`categories:children:${parentId}`, TREE_TTL_MS, () =>
      this.db.category.findMany({
        where: { parentId },
        orderBy: { score: 'desc' },
      }),
    );
  }
}
