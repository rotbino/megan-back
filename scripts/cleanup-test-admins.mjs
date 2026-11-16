// پاک‌سازی ادمین‌های تستی
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
await prisma.adminUser.deleteMany({ where: { OR: [{ username: 'verceltest' }, { username: { startsWith: 'e2e-' } }, { username: { startsWith: 'tmp-admin-' } }, { username: 'imgadmin' }] } });
const left = await prisma.adminUser.count();
console.log('test admins cleaned; total admins left:', left);
await prisma.$disconnect();
