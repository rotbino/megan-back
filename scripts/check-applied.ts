/**
 * بررسی دو فایل اصلاح‌شدهٔ امروز — URL تازه + دانلود + تشخیص مجدد (باید not_found باشد).
 * اجرا: bun scripts/check-applied.ts
 */
import '../src/common/config/env';
import { PrismaService } from '../src/common/prisma/prisma.module';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

async function main() {
  const prisma = new PrismaService();
  const ids = ['6af8f2d0bc32309c947787d7', '6af8f2d3bc32309c947787da'];
  for (const id of ids) {
    const f = await prisma.file.findUnique({ where: { id } });
    if (!f) continue;
    console.log(`${id} | fixedAt=${f.watermarkFixedAt?.toISOString() ?? '-'} | wm=${f.hasWatermark}`);
    console.log(`  main:   ${f.url.slice(-58)}`);
    console.log(`  thumb:  ${f.thumbUrl?.slice(-62) ?? '-'}`);
    // دانلود نسخهٔ تازه و تشخیص مجدد
    const out = `/tmp/applied-${id}.jpg`;
    try {
      execFileSync('curl', ['-sS', '-m', '60', '-o', out, f.url], { stdio: 'inherit' });
      const size = fs.statSync(out).size;
      const r = execFileSync(
        'python3',
        ['/home/z/my-project/repos/megan-back/python/image-editing/remove_one.py', out, '-o', '/tmp/x.jpg', '--json'],
        { cwd: '/home/z/my-project/repos/megan-back/python/image-editing', encoding: 'utf8', timeout: 120_000 },
      );
      const j = JSON.parse(r.trim().split('\n').pop()!);
      console.log(`  bytes=${size} | بازبینی: ${j.status} score=${j.score} evidence=${j.evidence}`);
    } catch (e) {
      console.log(`  دانلود/بررسی خطا: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  await prisma.$disconnect();
}
main();
