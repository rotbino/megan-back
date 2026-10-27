// تست E2E اندپوینت‌های جدید ویرایش آگهی + نام کامل فروشنده ادمین
import { config } from 'dotenv';
config({ override: true });

const API = 'http://127.0.0.1:4000/api/v1';

async function post(path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

async function main() {
  // ─── ورود کاربر تست رمزدار ───
  const login = await post('/auth/login', { phone: '09155557788', password: 'test1234' });
  const token = login.json?.data?.accessToken;
  check('ورود رمزدار کاربر تست', Boolean(token), JSON.stringify(login.json).slice(0, 200));

  // ─── آگهی‌های من ───
  const mine = await post('/products/getMyProducts', {}, token);
  const items = mine.json?.data?.items ?? [];
  console.log(`  آگهی‌ها: ${items.map((p) => `${p.id}(${p.status})`).join(', ') || 'هیچ'}`);
  const pending = items.find((p) => p.status === 'pending');
  const any = items[0];
  const target = pending ?? any;
  check('حداقل یک آگهی برای تست ویرایش', Boolean(target));

  if (target) {
    // ─── getMyProductDetail ───
    const detail = await post('/products/getMyProductDetail', { id: target.id }, token);
    const d = detail.json?.data;
    check('getMyProductDetail موفق', detail.status >= 200 && detail.status < 300 && Boolean(d?.id), JSON.stringify(detail.json).slice(0, 200));
    check('detail شامل photoFiles', Array.isArray(d?.photoFiles));
    check('detail شامل features/status', Array.isArray(d?.features) && typeof d?.status === 'string');

    // ─── دسترسی: آگهی غیرواقعی ───
    const notMine = await post('/products/getMyProductDetail', { id: 999999 }, token);
    check('آگهی ناموجود → 404', notMine.status === 404);

    // ─── updateMyProduct ───
    const up = await post('/products/updateMyProduct', {
      id: target.id,
      productName: d.productName,
      subCategoryId: d.subCategoryId,
      provinceId: d.provinceId,
      cityId: d.cityId,
      stock: d.stock,
      minSaleAmount: d.minSaleAmount,
      minSalePrice: d.minSalePrice,
      description: d.description,
      features: d.features ?? [],
    }, token);
    check('updateMyProduct موفق', up.status >= 200 && up.status < 300 && up.json?.data?.status === 'pending', JSON.stringify(up.json).slice(0, 300));

    // بعد از ویرایش دوباره pending است (حتی اگر قبلاً confirmed بود)
    const mine2 = await post('/products/getMyProducts', {}, token);
    const t2 = (mine2.json?.data?.items ?? []).find((p) => p.id === target.id);
    check('بعد از ویرایش → در انتظار تایید', t2?.status === 'pending');
  }

  // ─── ورود ادمین + نام کامل فروشنده ───
  const alogin = await post('/admin/auth/login', { username: '09196421264', password: 'admin434343' });
  const atoken = alogin.json?.data?.token;
  check('ورود ادمین', Boolean(atoken), JSON.stringify(alogin.json).slice(0, 200));
  if (atoken) {
    const list = await post('/admin/products/getProductList', { page: 1, perPage: 5 }, atoken);
    const rows = list.json?.data?.items ?? [];
    check('لیست ادمین آمد', rows.length > 0);
    const withName = rows.find((r) => r.seller?.full_name);
    console.log(`  نمونه فروشنده: user_name=${rows[0]?.seller?.user_name} full_name=${rows[0]?.seller?.full_name ?? '(نام کامل نیست)'}`);
    check('full_name فروشنده در ردیف‌ها', rows.some((r) => r.seller?.full_name));

    const br = await post('/admin/buy-requests/getBuyRequestList', { page: 1, perPage: 5 }, atoken);
    const brows = br.json?.data?.items ?? [];
    if (brows.length) {
      console.log(`  نمونه خریدار: user_name=${brows[0]?.buyer?.user_name} full_name=${brows[0]?.buyer?.full_name ?? '(نام کامل نیست)'}`);
      check('full_name خریدار در ردیف‌ها', brows.some((r) => r.buyer?.full_name));
    } else {
      console.log('  (درخواست خریدی برای تست نبود)');
    }
  }

  console.log(`\nنتیجه: ${pass} پاس / ${fail} خطا`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
