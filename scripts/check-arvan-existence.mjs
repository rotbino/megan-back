// چک زندهٔ وجود همهٔ فایل‌های صفحهٔ ۱ در آروان — کدام‌ها ۴۰۴ هستند و الگویشان چیست
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const files = await prisma.$runCommandRaw({
  aggregate: 'File',
  pipeline: [
    { $match: { related_model: 'Product', field_key: 'gallery', related_id: { $in: ['333481','326813','317353','327189','191481','317354','317928','185677'] } } },
    { $project: { url: 1, related_id: 1, created_at: 1 } },
    { $sort: { related_id: 1, created_at: 1 } },
  ],
  cursor: {},
});
const rows = files.cursor?.firstBatch ?? [];
let ok = 0, missing = 0;
for (const r of rows) {
  try {
    const res = await fetch(r.url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
    if (res.ok) ok++;
    else { missing++; console.log(`MISSING ${res.status} pid=${r.related_id} ${String(r.url).split('/').pop()}`); }
  } catch (e) {
    missing++;
    console.log(`ERROR pid=${r.related_id} ${String(r.url).split('/').pop()} — ${e.message}`);
  }
}
console.log(`\nsummary: ok=${ok} missing=${missing} / total=${rows.length}`);
await prisma.$disconnect();
