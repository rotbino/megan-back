// بررسی وضعیت واقعی دیتابیس: کاربران، رمزها، آگهی‌ها، درخواست‌های خرید
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const pad = (s, n) => String(s ?? '').padEnd(n, ' ');

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true, phone: true, userName: true, firstName: true, lastName: true,
      role: true, isActive: true, isBuyer: true, isSeller: true,
      passwordHash: true, provinceId: true, cityId: true, createdAt: true,
      _count: { select: { products: true, buyRequests: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`== ${users.length} کاربر ==`);
  for (const u of users.slice(0, 30)) {
    console.log(
      pad(u.phone, 12), pad((u.firstName||'') + ' ' + (u.lastName||''), 22),
      pad(u.userName||'-', 10), 'role:' + pad(u.role, 8),
      u.passwordHash ? 'PASS✓' : 'no-pass', 'prov:' + pad(u.provinceId, 5),
      'city:' + pad(u.cityId, 5), 'prod:' + pad(u._count.products, 4),
      'buyReq:' + u._count.buyRequests,
    );
  }

  const prodCount = await prisma.product.count();
  const reqCount = await prisma.buyRequest.count();
  console.log(`\n== محصولات: ${prodCount} | درخواست خرید: ${reqCount} ==`);

  // چند محصول نمونه با یوزرشان
  const prods = await prisma.product.findMany({
    select: { id: true, userId: true, title: true, status: true, categoryId: true, isDeleted: true },
    take: 10,
  });
  for (const p of prods) console.log('prod', p.id, 'user:', p.userId, pad(p.title, 30), 'status:', p.status, 'deleted:', p.isDeleted);

  const reqs = await prisma.buyRequest.findMany({
    select: { id: true, userId: true, title: true, status: true, isDeleted: true },
    take: 10,
  });
  for (const r of reqs) console.log('req ', r.id, 'user:', r.userId, pad(r.title, 30), 'status:', r.status, 'deleted:', r.isDeleted);
}

main().finally(() => prisma.$disconnect());
