import { readFileSync } from 'fs';
const env = readFileSync('.env', 'utf8');
process.env.DATABASE_URL = env.match(/DATABASE_URL="([^"]+)"/)[1];
const { PrismaClient } = await import('@prisma/client');
const p = new PrismaClient();
const arr = await p.user.findMany({ where: { provinceId: null }, select: { phone: true, provinceId: true }, take: 5 });
console.log('findMany provinceId:null →', arr.length, JSON.stringify(arr));
const arr2 = await p.user.findMany({ where: { provinceId: { equals: null } }, select: { phone: true }, take: 5 });
console.log('findMany equals:null →', arr2.length);
// raw mongo
const raw = await p.$runCommandRaw({ count: 'users', query: { province_id: null } });
console.log('raw mongo count province_id:null →', JSON.stringify(raw));
await p.$disconnect();
