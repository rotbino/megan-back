import { readFileSync } from 'fs';
const env = readFileSync('.env', 'utf8');
process.env.DATABASE_URL = env.match(/DATABASE_URL="([^"]+)"/)[1];
const { PrismaClient } = await import('@prisma/client');
const p = new PrismaClient();
// how many have products or buyRequests (active-looking users)?
const noName = await p.user.findMany({ where: { firstName: '' }, select: { id: true, phone: true, userName: true, isSeller: true, isBuyer: true, _count: { select: { products: true, buyRequests: true } } }, take: 200 });
const withActivity = noName.filter(u => u._count.products > 0 || u._count.buyRequests > 0);
console.log('no-name users:', noName.length, '| with products/requests:', withActivity.length);
withActivity.slice(0, 10).forEach(u => console.log(JSON.stringify({ phone: u.phone, products: u._count.products, buyRequests: u._count.buyRequests })));
// sample province/city ids available
const provs = await p.province.findMany({ select: { id: true, name: true }, take: 8 });
console.log('provinces sample:', JSON.stringify(provs));
await p.$disconnect();
