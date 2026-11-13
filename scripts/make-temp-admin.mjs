// ساخت ادمین موقت SUPER_ADMIN برای تست بصری — توکن را چاپ می‌کند
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
const scryptAsync = promisify(scrypt);
const prisma = new PrismaClient();

const username = `vis-temp-${Date.now().toString(36)}`;
const password = 'VisT-' + randomBytes(6).toString('base64url');
const salt = randomBytes(16).toString('base64url');
const key = await scryptAsync(password.normalize('NFKC'), salt, 64);
await prisma.adminUser.create({
  data: {
    username,
    passwordHash: `scrypt:${salt}:${key.toString('base64')}`,
    name: 'تست بصری موقت',
    role: 'SUPER_ADMIN',
    isActive: true,
  },
});
const res = await fetch('http://localhost:4000/api/v1/admin/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
const body = await res.json();
console.log(body?.data?.token ?? '');
await prisma.$disconnect();
