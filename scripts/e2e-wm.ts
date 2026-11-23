/**
 * E2E محلی سرویس حذف واترمارک — بدون HTTP، با سرویس‌های واقعی:
 *   ۱) previewOne روی ۳ فایل صف (بدون تغییر چیزی)
 *   ۲) applyOne روی یک فایل واقعی (تعویض درجا + مهر اصلاح)
 *   ۳) پیش‌نمایش مجدد روی URL تازه → واترمارک باید رفته باشد
 * اجرا: bun scripts/e2e-wm.ts
 */
import { PrismaService } from '../src/common/prisma/prisma.module';
import { CacheService } from '../src/common/cache/cache.module';
import { UploadsService } from '../src/uploads/uploads.service';
import { PascalWatermarkService } from '../src/importer/pascal-wm.service';

async function main() {
  const prisma = new PrismaService();
  const cache = new CacheService();
  const uploads = new UploadsService(prisma, cache);
  const wm = new PascalWatermarkService(prisma, uploads);

  const queue = await prisma.file.findMany({
    where: {
      relatedModel: 'Product',
      fieldKey: 'gallery',
      hasWatermark: true,
      storageKey: { not: null },
    },
    orderBy: { id: 'asc' },
    take: 3,
    select: { id: true, relatedId: true, url: true },
  });
  console.log('صف:', (await prisma.file.count({
    where: { relatedModel: 'Product', fieldKey: 'gallery', hasWatermark: true, storageKey: { not: null } },
  })), 'فایل — نمونه:', queue.map((f) => f.id).join(', '));

  for (const f of queue) {
    const r = await wm.previewOne(f.id);
    console.log(
      `پیش‌نمایش ${f.id.slice(0, 10)}: ${r.status} score=${r.score} evid=${r.evidence} box=${r.box ? `${r.box.x},${r.box.y} ${r.box.w}x${r.box.h}` : '-'} ms=${r.ms} ` +
        `compare=${r.compareDataUrl ? Math.round(r.compareDataUrl.length / 1024) + 'KB' : '-'} after=${r.afterDataUrl ? Math.round(r.afterDataUrl.length / 1024) + 'KB' : '-'}`,
    );
  }

  // اعمال روی اولین فایلی که قوی تشخیص شد
  const target = queue[0];
  const before = await prisma.file.findUnique({ where: { id: target.id } });
  console.log(`\nاعمال روی ${target.id} (url قدیمی: ...${before?.url?.slice(-40)})`);
  const t0 = Date.now();
  const r = await wm.applyOne(target.id, 'e2e-wm-test');
  console.log(`نتیجه: ${r.status} در ${Date.now() - t0}ms — file=${r.file ? 'به‌روز شد' : 'تغییر نکرد'}`);
  if (r.file) {
    const after = await prisma.file.findUnique({ where: { id: target.id } });
    console.log('ردیف تازه:', {
      hasWatermark: after?.hasWatermark,
      watermarkFixedAt: after?.watermarkFixedAt,
      url: '...' + after?.url?.slice(-52),
    });
    // پیش‌نمایش مجدد روی نسخهٔ تازه — واترمارک باید رفته باشد
    const r2 = await wm.previewOne(target.id);
    console.log(`بازبینی بعد از اعمال: ${r2.status} score=${r2.score} evid=${r2.evidence}`);
    console.log(
      r2.status === 'removed'
        ? '⚠️ هنوز قابل تشخیص است!'
        : '✓ واترمارک کاملاً حذف و دیگر قابل تشخیص نیست',
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('E2E خطا:', e);
  process.exit(1);
});
