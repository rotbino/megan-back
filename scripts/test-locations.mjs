#!/usr/bin/env node
/**
 * تست صحت مدل لوکیشن درختی واحد — اجرا: node scripts/test-locations.mjs
 * ۳۱ استان + ۴۷۴ شهر + برخورد id ها (شهر ۴=بستان‌آباد، استان ۴=اصفهان) + درخت والد.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env'), override: true });

let passed = 0, failed = 0;
const check = (title, ok, extra = '') => {
  console.log(`${ok ? '✔' : '✖'} ${title}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

const client = new MongoClient(process.env.DATABASE_URL, { serverSelectionTimeoutMS: 20000 });
await client.connect();
const loc = client.db().collection('Location');

const total = await loc.countDocuments();
check('مجموع ۵۰۵ گره', total === 505, `got ${total}`);

const provCount = await loc.countDocuments({ type: 'province' });
check('۳۱ استان', provCount === 31, `got ${provCount}`);

const cityCount = await loc.countDocuments({ type: 'city' });
check('۴۷۴ شهر', cityCount === 474, `got ${cityCount}`);

// برخورد id عددی: شهر ۴=بستان‌آباد (استان ۱) و استان ۴=اصفهان — هر دو باید موجود باشند
const city4 = await loc.findOne({ _id: 'city:4' });
check('city:4 = بستان آباد', city4?.name === 'بستان آباد', city4?.name ?? 'not found');
const prov4 = await loc.findOne({ _id: 'province:4' });
check('province:4 = اصفهان', prov4?.name === 'اصفهان', prov4?.name ?? 'not found');
check('city:4 → parent province:1', city4?.parent_id === 'province:1', city4?.parent_id);

// شهر بابک ۲۳۰ → کرمان ۲۱
const batak = await loc.findOne({ _id: 'city:230' });
check('city:230 = شهر بابک (کرمان ۲۱)', batak?.name === 'شهر بابک' && batak?.parent_id === 'province:21', JSON.stringify({ name: batak?.name, parent: batak?.parent_id }));

// buskool_id ها در هر type یکتا
const dupCity = await loc.aggregate([
  { $match: { type: 'city' } },
  { $group: { _id: '$buskool_id', n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } },
]).toArray();
check('buskool_id شهرها یکتا', dupCity.length === 0);

// هر شهری والد استان دارد
const orphanCities = await loc.aggregate([
  { $match: { type: 'city' } },
  { $lookup: { from: 'Location', localField: 'parent_id', foreignField: '_id', as: 'p' } },
  { $match: { 'p.0': { $exists: false } } },
]).toArray();
check('هیچ شهری یتیم نیست', orphanCities.length === 0, `${orphanCities.length} یتیم`);

// هر استان بچه دارد
const provsWithKids = await loc.aggregate([
  { $match: { type: 'province' } },
  { $lookup: { from: 'Location', localField: '_id', foreignField: 'parent_id', as: 'kids' } },
  { $match: { 'kids.0': { $exists: true } } },
]).toArray();
check('هر ۳۱ استان شهر دارد', provsWithKids.length === 31, `${provsWithKids.length}`);

await client.close();
console.log(`\n📍 ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
