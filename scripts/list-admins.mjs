#!/usr/bin/env node
/** one-off: list admin usernames (no secrets) */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env'), override: true });
const p = new PrismaClient();
const admins = await p.adminUser.findMany({ select: { username: true, isActive: true, role: true } });
console.log(admins);
await p.$disconnect();
