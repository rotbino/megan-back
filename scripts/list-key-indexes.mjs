#!/usr/bin/env node
/** وضعیت ایندکس‌های User/Product/File/WebImportSession/Affiliate* روی Atlas (۲۲-۱۱) */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

const root = new URL('../', import.meta.url).pathname;
dotenv.config({ path: `${root}.env`, override: true });

const client = new MongoClient(process.env.DATABASE_URL, { serverSelectionTimeoutMS: 15_000 });
await client.connect();
const db = client.db();

for (const col of ['User', 'Product', 'File', 'WebImportSession', 'AffiliateProfile', 'AffiliateEarning', 'AffiliateMessage']) {
  const idx = await db.collection(col).listIndexes().toArray().catch(() => []);
  console.log(`\n── ${col} (${idx.length} ایندکس)`);
  for (const i of idx) {
    const keys = Object.entries(i.key).map(([k, v]) => `${k}:${v}`).join(',');
    console.log(`   ${i.name}${i.unique ? ' [unique]' : ''} → ${keys}`);
  }
}
await client.close();
