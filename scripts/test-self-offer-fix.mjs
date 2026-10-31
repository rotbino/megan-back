#!/usr/bin/env node
/**
 * تست سرتاسری رفع باگ ۱-۱۱:
 *  ۱) دایرکتوری با توکن → کارت‌های خود بیننده حذف شود
 *  ۲) دایرکتوری مهمان → همه کارت‌ها
 *  ۳) sendSupplyOffer به خود → خطای شفاف SELF_OFFER (نه «خریدار یافت نشد»)
 *  ۴) sendSupplyOffer به خریدار واقعی → موفق + پیام چت تحویل شد
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });

const BASE = 'http://localhost:4000/api/v1';
let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}
async function api(path, body, token) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

async function main() {
  console.log('— ۱) ورود فروشندهٔ دارندهٔ بسته (میرعلی 09144133782)');
  let token;
  const loginRes = await api('auth/login', { phone: '09144133782' });
  if (loginRes.status) {
    token = loginRes.data.accessToken;
  } else {
    // با OTP ثابت ۱۲۳۴
    await api('auth/sendOtp', { phone: '09144133782' });
    const otpRes = await api('auth/verifyOtp', { phone: '09144133782', code: '1234' });
    if (!otpRes.status) { console.log('ورود ناموفق:', JSON.stringify(otpRes)); process.exit(1); }
    token = otpRes.data.accessToken;
  }
  check('ورود فروشنده', !!token);

  console.log('— ۲) دایرکتوری مهمان — همهٔ کارت‌ها');
  const guest = await api('buyers/directory', { page: 1, perPage: 48 });
  const guestItems = guest.data?.items ?? [];
  check('مهمان همه را می‌بیند', guestItems.length >= 5, `(${guestItems.length} کارت)`);
  const guestNames = [...new Set(guestItems.map((i) => i.buyerName))];
  console.log(`    خریداران مهمان: ${guestNames.join('، ')}`);

  console.log('— ۳) دایرکتوری با توکن — کارت‌های خود حذف شود');
  const mine = await api('buyers/directory', { page: 1, perPage: 48 }, token);
  const myItems = mine.data?.items ?? [];
  const stillSelf = myItems.filter((i) => i.buyerName.includes('میرعلی'));
  check('کارت خود فروشنده در دایرکتوری خودش نیست', stillSelf.length === 0, JSON.stringify(stillSelf.map((i) => i.buyerName)));
  check('کارت خریدار دیگر هست', myItems.some((i) => i.buyerName.includes('سعید محمدی')), `(${myItems.length} کارت)`);

  console.log('— ۴) دایرکتوری با توکنِ خراب — مثل مهمان (بدون ۵۰۰)');
  const badToken = await api('buyers/directory', { page: 1, perPage: 48 }, 'this-is-not-a-jwt');
  check('توکن خراب → لیست کامل بدون خطا', badToken.status === true && (badToken.data?.items?.length ?? 0) === guestItems.length);

  console.log('— ۵) شناسهٔ خودم برای تست SELF_OFFER');
  // دفتر خرید خودم را از getMyBook می‌گیرم اما buyerId من = sub توکن؛ از دایرکتوری مهمان کارت خودم را پیدا می‌کنم
  const selfCard = guestItems.find((i) => i.buyerName.includes('میرعلی'));
  check('کارت خود در دایرکتوری مهمان هست', !!selfCard);
  if (selfCard) {
    const selfOffer = await api('buyers/sendSupplyOffer', { buyerId: selfCard.buyerId, message: 'تست ارسال به خود' }, token);
    check(
      'خطای شفاف SELF_OFFER (نه «خریدار یافت نشد»)',
      selfOffer.status === false && selfOffer.code === 'SELF_OFFER' && !selfOffer.message.includes('یافت نشد'),
      JSON.stringify(selfOffer),
    );
    console.log(`    پیام: ${selfOffer.message}`);
  }

  console.log('— ۶) ارسال تکی به خریدار واقعی (سعید محمدی)');
  const target = guestItems.find((i) => i.buyerName.includes('سعید محمدی'));
  check('کارت سعید محمدی هست', !!target);
  if (target) {
    const draft = 'سلام، جناب سعید محمدی. میرعلی سیدزاده هستم، فروشنده عمده سیب زمینی آگریا، با بهترین قیمت و کیفیت از قرار کیلویی ۵۰ هزار تومان. در صورتی که علاقه‌مند هستید توی چت پیام بدید.';
    const offer = await api('buyers/sendSupplyOffer', { buyerId: target.buyerId, message: draft }, token);
    check('ارسال موفق', offer.status === true, JSON.stringify(offer));
    if (offer.status) console.log(`    threadId=${offer.data.threadId} quotaLeft=${offer.data.quotaLeft}`);

    console.log('— ۷) تکرار به همان خریدار — سهمیه نمی‌گیرد اما موفق است');
    const again = await api('buyers/sendSupplyOffer', { buyerId: target.buyerId, message: draft }, token);
    check('ارسال دوباره موفق', again.status === true, JSON.stringify(again));
  }

  console.log(`\nنتیجه: ${passed} پاس / ${failed} خطا`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
