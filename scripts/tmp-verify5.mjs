import { readFileSync } from 'fs';
const env = readFileSync('.env', 'utf8');
process.env.DATABASE_URL = env.match(/DATABASE_URL="([^"]+)"/)[1];
const { PrismaClient } = await import('@prisma/client');
const p = new PrismaClient();
// findRaw with filter for missing/null province
const docs = await p.user.findRaw({
  filter: { $or: [{ province_id: null }, { province_id: { $exists: false } }] },
  options: { limit: 5, projection: { _id: 1, phone: 1, first_name: 1 } },
});
console.log('findRaw null/missing province:', docs.length);
docs.forEach(d => console.log(JSON.stringify(d)));
await p.$disconnect();
