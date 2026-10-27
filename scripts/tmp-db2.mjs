import { readFileSync } from 'fs';
const env = readFileSync('.env', 'utf8');
process.env.DATABASE_URL = env.match(/DATABASE_URL="([^"]+)"/)[1];
const { PrismaClient } = await import('@prisma/client');
const p = new PrismaClient();
const u = await p.user.findFirst({ where: { phone: '09196421264' }, select: { phone: true, firstName: true, passwordHash: true } });
console.log('found:', JSON.stringify(u));
await p.$disconnect();
