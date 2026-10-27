import { readFileSync } from 'fs';
const env = readFileSync('.env', 'utf8');
process.env.DATABASE_URL = env.match(/DATABASE_URL="([^"]+)"/)[1];
const { PrismaClient } = await import('@prisma/client');
const p = new PrismaClient();
const bad = await p.$runCommandRaw({ count: 'User', query: { $or: [
  { first_name: null }, { first_name: { $exists: false } }, { first_name: '' },
  { province_id: null }, { province_id: { $exists: false } },
] } });
console.log('remaining incomplete users:', JSON.stringify(bad));
const samples = await p.user.findMany({ select: { phone: true, firstName: true, lastName: true, provinceId: true, cityId: true }, take: 4, orderBy: { phone: 'asc' } });
samples.forEach(s => console.log(JSON.stringify(s)));
await p.$disconnect();
