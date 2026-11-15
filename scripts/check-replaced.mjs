// فایل‌های دارای بج تعویض (replacedAt) — بررسی و پاک‌سازی اثر تست‌ها
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const agg = await prisma.$runCommandRaw({
  aggregate: 'File',
  pipeline: [
    { $match: { 'metadata.replacedAt': { $ne: null } } },
    { $project: { url: 1, 'metadata.replacedAt': 1, related_id: 1 } },
  ],
  cursor: {},
});
const rows = agg.cursor?.firstBatch ?? [];
for (const r of rows) {
  console.log(String(r.url).slice(-44), '| pid:', r.related_id, '|', r.metadata?.replacedAt);
}

if (process.argv[2] === '--clean') {
  for (const r of rows) {
    await prisma.$runCommandRaw({
      update: 'File',
      updates: [
        { q: { _id: r._id }, u: { $set: { 'metadata.replacedAt': null } } },
      ],
    });
  }
  console.log(`cleaned ${rows.length} files (replacedAt → null)`);
}
await prisma.$disconnect();
