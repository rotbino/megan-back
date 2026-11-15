// مقایسهٔ رکوردهای File برای آگهی سالم (191481) و آگهی خراب (317928) — چرا بعضی فایل‌ها در آروان نیستند؟
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

for (const pid of [191481, 317928, 185677, 333481]) {
  const files = await prisma.$runCommandRaw({
    aggregate: 'File',
    pipeline: [
      { $match: { related_model: 'Product', field_key: 'gallery', related_id: String(pid) } },
      { $project: { url: 1, thumb_url: 1, size: 1, name: 1, created_at: 1, metadata: 1, storage: 1, storage_provider: 1, provider: 1 } },
      { $sort: { created_at: 1 } },
    ],
    cursor: {},
  });
  const rows = files.cursor?.firstBatch ?? [];
  console.log(`\n=== product #${pid} — ${rows.length} files ===`);
  for (const r of rows) {
    const meta = r.metadata ?? {};
    console.log(JSON.stringify({
      name: r.name,
      url: String(r.url ?? '').slice(0, 95),
      thumb: String(r.thumb_url ?? '').slice(-30),
      size: r.size,
      importedFrom: meta.importedFrom,
      originalUrl: String(meta.originalUrl ?? '').slice(0, 80),
      hasWidth: meta.width != null,
      replacedAt: meta.replacedAt,
    }));
  }
}
await prisma.$disconnect();
