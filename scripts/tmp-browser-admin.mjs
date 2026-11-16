// ادمین موقت برای تست مرورگر صفحات data-import — فقط برای همین سشن تست
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
const scryptAsync = promisify(scrypt);
const prisma = new PrismaClient();

const USER = process.argv[2] ?? `tmp-admin-${Date.now().toString(36)}`;
const PASS = process.argv[3] ?? 'Tmp-Admin-12345';
async function hashPassword(plain) {
  const salt = randomBytes(16).toString('base64url');
  const key = await scryptAsync(plain.normalize('NFKC'), salt, 64);
  return `scrypt:${salt}:${key.toString('base64')}`;
}
const existing = await prisma.adminUser.findUnique({ where: { username: USER } });
if (!existing) {
  await prisma.adminUser.create({
    data: { username: USER, passwordHash: await hashPassword(PASS), name: 'تست موقت', role: 'SUPER_ADMIN', isActive: true },
  });
}
console.log(`admin ready: ${USER} / ${PASS}`);
await prisma.$disconnect();
