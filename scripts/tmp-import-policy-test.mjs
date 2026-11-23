// تست زندهٔ «سیاست خطای رکورد» (خواستهٔ مالک ۱۵-۱۱) — موقتی، بعد از تست پاک شود.
//
// سناریو: کالکشن منبع موقتی با ۳ یوزرنیم جعلی (در پاسکال وجود ندارند) →
// جاب لیستی باید هر سه را «ذخیره و رد» کند و در پایان «done» شود، نه اینکه
// بعد از ۳ شکست پیاپی متوقف شود (رفتار قدیمی). دلیل خطا هم باید روی
// profile.bImportError رکوردهای stub ثبت شده باشد.
//
// اجرا:
//   node scripts/tmp-import-policy-test.mjs setup    # ساخت کالکشن موقتی
//   node scripts/tmp-import-policy-test.mjs verify    # بررسی stub ها + bImportError
//   node scripts/tmp-import-policy-test.mjs cleanup   # حذف stub ها + کالکشن موقتی
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// override:true — سندباکس DATABASE_URL خودش را دارد؛ .env پروژه ملاک است
dotenv.config({ path: '.env', override: true });

const prisma = new PrismaClient();
const TABLE = 'tmp-import-policy-test';
const FAKES = ['zzz-not-exist-9101', 'zzz-not-exist-9102', 'zzz-not-exist-9103'];

async function dropTable() {
  await prisma.$runCommandRaw({ drop: TABLE }).catch(() => undefined);
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'setup') {
    await dropTable();
    await prisma.$runCommandRaw({
      insert: TABLE,
      documents: FAKES.map((userName) => ({ userName, phone: null, _note: 'tmp-import-policy-test' })),
    });
    const res = await prisma.$runCommandRaw({ count: TABLE });
    console.log(`setup ✓ — ${TABLE}: ${res.n} سند جعلی (غیرموجود در پاسکال)`);
    console.log('حالا دیمن را با IMPORT_SOURCE_TABLE=' + TABLE + ' ری‌استارت کن و جاب لیستی limit=3 بزن.');
  } else if (mode === 'verify') {
    const stubs = await prisma.user.findMany({
      where: { bUserName: { in: FAKES } },
      select: { userName: true, failedImport: true, bUserName: true, profile: true },
    });
    console.log(`stub ها: ${stubs.length} از ${FAKES.length}`);
    let okCount = 0;
    for (const s of stubs) {
      const err = (s.profile ?? {})?.bImportError;
      // پاسکال برای یوزرنیم ناشناس 404 می‌دهد (سنجش زنده) — هر دو امضای
      // user-not-found و http-404 «خطای رکورد» معتبرند
      const good =
        s.failedImport === true &&
        err &&
        typeof err.message === 'string' &&
        err.message.length > 0 &&
        (err.sig === 'user-not-found' || err.sig === 'http-404') &&
        typeof err.at === 'string';
      if (good) okCount++;
      console.log(
        `  ${good ? '✓' : '✗'} ${s.userName} (b=${s.bUserName}) failedImport=${s.failedImport} ` +
          `err="${err ? String(err.message).slice(0, 60) : null}" sig=${err?.sig ?? null}`,
      );
    }
    console.log(okCount === FAKES.length ? 'verify ✓ — همهٔ دلایل خطا درست ذخیره شده‌اند' : 'verify ✗ — نقص!');
    process.exitCode = okCount === FAKES.length ? 0 : 1;
  } else if (mode === 'cleanup') {
    // فقط همین stub های تستی — هیچ چیز دیگری دست نمی‌خورد
    const del = await prisma.user.deleteMany({ where: { bUserName: { in: FAKES } } });
    await dropTable();
    console.log(`cleanup ✓ — ${del.count} stub حذف شد؛ کالکشن ${TABLE} افتاد`);
  } else {
    console.log('mode؟ setup | verify | cleanup');
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
