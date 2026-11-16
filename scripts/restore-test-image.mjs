// برگرداندن عکس تستی به نسخهٔ اصلی (round-trip UI replace تست شد)
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
const scryptAsync = promisify(scrypt);
const prisma = new PrismaClient();

const TEST_ADMIN = `e2e-restore-${Date.now().toString(36)}`;
const TEST_PASS = 'Rst-' + randomBytes(6).toString('base64url');
async function hashPassword(plain) {
  const salt = randomBytes(16).toString('base64url');
  const key = await scryptAsync(plain.normalize('NFKC'), salt, 64);
  return `scrypt:${salt}:${key.toString('base64')}`;
}
await prisma.adminUser.create({
  data: { username: TEST_ADMIN, passwordHash: await hashPassword(TEST_PASS), name: 'تست موقت', role: 'ADMIN', isActive: true },
});
const loginRes = await fetch('http://localhost:4000/api/v1/admin/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: TEST_ADMIN, password: TEST_PASS }),
});
const token = (await loginRes.json())?.data?.token;

// File id از روی URL
const file = await prisma.$runCommandRaw({
  aggregate: 'File',
  pipeline: [
    { $match: { url: { $regex: 'mwhzzicm-83ebd91ee4\\.jpg$' } } },
    { $project: { _id: 1 } },
  ],
  cursor: {},
});
const fileId = file.cursor?.firstBatch?.[0]?._id;
const fileIdStr = fileId && typeof fileId === 'object' && fileId.toString !== undefined
  ? (fileId.$oid ?? String(fileId))
  : String(fileId);
console.log('fileId:', fileIdStr);
if (!fileIdStr || fileIdStr === 'undefined') process.exit(1);

const form = new FormData();
const buf = await readFile('/tmp/orig-test.jpg');
form.append('file', new Blob([buf], { type: 'image/jpeg' }), 'orig-test.jpg');
const res = await fetch(`http://localhost:4000/api/v1/importer/product-images/${fileIdStr}/replace`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
const body = await res.json();
console.log('restore:', res.status, body?.status, '| size:', body?.data?.size);

await prisma.adminUser.delete({ where: { username: TEST_ADMIN } }).catch(() => {});
await prisma.$disconnect();
