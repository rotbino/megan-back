// عیب‌یابی فقط-خواندی: توضیحات محصولاتِ کاربران ایمپورت‌شده — چند مورد شامل برند؟
import { config } from 'dotenv';
config({ override: true });

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const norm = (t) =>
  String(t ?? '')
    .replace(/\u200c/g, ' ')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک');

const users = await prisma.user.findMany({
  where: { bUserName: { not: null } },
  select: { id: true, userName: true },
});
const ids = users.map((u) => u.id);

const products = await prisma.product.findMany({
  where: { userId: { in: ids } },
  select: { id: true, productName: true, description: true },
});
console.log(`محصولات کاربران ایمپورت‌شده: ${products.length}`);

const hits = products.filter((p) => {
  const t = norm(p.description);
  return t.includes('باسکول') || t.includes('اینکوباک');
});
console.log(`توضیحات محصول شامل باسکول/اینکوباک: ${hits.length}`);
for (const p of hits.slice(0, 8)) {
  console.log(`  #${p.id} «${p.productName}»: ${norm(p.description).replace(/\s+/g, ' ').slice(0, 160)}`);
}

// کامنت‌های باسکول (جدول b_comment جدید)
try {
  const res = await prisma.$runCommandRaw({ count: 'b_comment' });
  console.log(`\nاسناد b_comment: ${Number(res?.n ?? 0)}`);
} catch {
  console.log('\nکالکشن b_comment وجود ندارد (هنوز مهاجرت نشده)');
}

await prisma.$disconnect();
