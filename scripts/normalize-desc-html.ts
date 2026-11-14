/**
 * Backfill یک‌باره: توضیحات آگهی‌های موجود را از HTML باسکول (<hr/> و
 * خواهرانش) به متن سادهٔ چندخطی تبدیل می‌کند (خواستهٔ مالک ۱۴-۱۱).
 *
 * اجرا:  DATABASE_URL=... bun scripts/normalize-desc-html.ts [--dry]
 * idempotent — دوباره اجرا هیچ تغییری نمی‌دهد.
 */
import { PrismaClient } from '@prisma/client';
import { descToText } from '../src/importer/desc-text';

const dry = process.argv.includes('--dry');
const p = new PrismaClient();

(async () => {
  const dirty = await p.product.findMany({
    where: { OR: [{ description: { contains: '<' } }, { description: { contains: '&' } }] },
    select: { id: true, description: true, updatedAt: true },
  });
  console.log(`آگهی‌های نیازمند پاکسازی: ${dirty.length} (از کل ${await p.product.count()})`);

  let changed = 0;
  for (const row of dirty) {
    const clean = descToText(row.description);
    if (clean === (row.description ?? '').trim()) continue;
    changed++;
    if (dry) continue;
    // مهر updated_at حفظ می‌شود (درس ۱۵-۱۱): update عادی پریسما @updatedAt را
    // به «اکنون» می‌برد و آگهی چندساله را بالای «جدیدترین» می‌نشاند
    await p.product.update({
      where: { id: row.id },
      data: { description: clean, updatedAt: row.updatedAt },
    });
  }
  console.log(dry ? `[dry-run] تغییرنیافته: ${changed}` : `به‌روز شد: ${changed}`);

  // نمونهٔ قبل/بعد
  const sample = dirty[0];
  if (sample) {
    console.log('\n── نمونه:');
    console.log('قبل:', JSON.stringify(sample.description).slice(0, 300));
    console.log('بعد:', JSON.stringify(descToText(sample.description)).slice(0, 300));
  }
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR:', String(e).slice(0, 400));
  process.exit(1);
});
