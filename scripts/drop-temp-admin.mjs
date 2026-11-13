// حذف ادمین‌های موقت تست (vis-temp-* و e2e-temp-*)
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const r = await prisma.adminUser.deleteMany({
  where: { OR: [{ username: { startsWith: 'vis-temp-' } }, { username: { startsWith: 'e2e-temp-' } }] },
});
console.log(`deleted ${r.count} temp admins`);
await prisma.$disconnect();
