import { readFileSync } from 'fs';
const env = readFileSync('.env', 'utf8');
process.env.DATABASE_URL = env.match(/DATABASE_URL="([^"]+)"/)[1];
const { PrismaClient } = await import('@prisma/client');
const p = new PrismaClient();
const u = await p.user.findUnique({ where: { phone: '09144133782' }, select: { id: true, isActive: true, sessionsRevokedAt: true } });
console.log('user state:', JSON.stringify(u), '| now:', new Date().toISOString());
await p.$disconnect();
