// کاشت دو پیشنهاد تامین واقعی برای کاربر تست خریدار (سعید محمدی) تا جریان
// «کلیک روی کالای دفتر خرید → پیشنهادهای همان گروه» در مرورگر قابل رایتست باشد
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const BASE = 'http://localhost:4000/api/v1';

async function api(path, body, token) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

async function main() {
  // فروشندهٔ تستی (بستهٔ فعال لازم است — گرنه سهمیه صفر است)
  const seller = await prisma.user.findFirst({ where: { phone: '09150000002' } });
  if (!seller) throw new Error('فروشنده تست 09150000002 پیدا نشد');
  await prisma.user.update({
    where: { id: seller.id },
    data: {
      activePakageType: 2,
      packageExpiresAt: new Date(Date.now() + 180 * 86400000),
      firstName: 'فروشنده',
      lastName: 'تستی ایمچ',
    },
  });

  const buyer = await prisma.user.findFirst({ where: { phone: '09123456789' } });
  if (!buyer) throw new Error('خریدار تست پیدا نشد');

  // دسته‌های دفتر خرید خریدار (مدل BuyerCategory)
  const items = await prisma.buyerCategory.findMany({ where: { userId: buyer.id } });
  console.log('دفتر خرید:', JSON.stringify(items.map((i) => ({ c: i.categoryId }))));

  const login = await api('auth/login', { phone: '09150000002' });
  if (!login.status) throw new Error('login failed: ' + JSON.stringify(login));
  const token = login.data.accessToken;

  const byCat = Object.fromEntries(items.map((i) => [i.categoryId, i.unit ?? '']));
  const cats = Object.keys(byCat).map(Number).slice(0, 2);
  for (const cat of cats) {
    const r = await api(
      'buyers/sendSupplyOffer',
      {
        buyerId: buyer.id,
        message: `پیشنهاد تامین آزمایشی برای دسته ${cat} — قیمت توافقی عمده، ارسال از تهران.`,
        categoryId: cat,
        productType: 'درجه یک',
        checkAccepted: true,
        checkPercent: 50,
        checkMaxDays: 30,
        deliveryToBuyer: true,
        shippingCostBy: 'seller',
        minOrderAmount: 100,
      },
      token,
    );
    console.log(`offer (cat=${cat}):`, r.status ? 'OK' : JSON.stringify(r));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
