# Megan Backend — ایمچ

مارکت‌پلیس B2B عمده‌فروشی **ایمچ (iMach)** — کلون Buskool با برند مستقل.

**پشته:** NestJS 11 + Fastify 5 + Mongoose 9 → **MongoDB Atlas** (`megan_online_db`) + ArvanCloud Object Storage (تصاویر)

## معماری

- مستندات کامل و نقشه راه فاز به فاز: **[docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)**
- Swagger (در development): `http://localhost:4000/docs`
- قرارداد پاسخ یکنواخت: `{ status: true, data, message? }` / `{ status: false, message, code? }`
- نام‌گذاری اندپوینت‌ها خوانا و فعلی (مثل `getUserByPhone`) — اکثراً POST
- کش درون‌حافظه با TTL برای داده‌های پایه (قابل تعویض با Redis)
- احراز: موبایل + OTP ۵ رقمی → JWT دسترسی + رفرش‌توکن چرخشی

## اجرا

```bash
bun install               # یا npm install
bun run build             # tsc → dist/
node dist/main.js         # → http://localhost:4000

# seed داده‌های پایه (دسته‌ها/استان‌ها/شهرها) از APIهای عمومی باسکول
bun run seed:base-data
```

## ساختار

```
src/
  main.ts                 # بوت Fastify + helmet/cors/compress + Swagger + ایندکس‌ها
  app.module.ts           # اتصال Atlas + ماژول‌ها
  db-indexes.ts           # ایندکس‌های صریح (منبع حقیقت)
  common/                 # کش، گارد JWT، فیلتر خطا، قرارداد پاسخ
  auth/                   # sendOtp / verifyOtp / refreshToken / logout
  users/                  # getProfile / updateProfile / getUserByPhone
  categories/             # getAllCategories / getCategoriesByParent (کش)
  locations/              # getAllProvinces / getCitiesByProvince (کش)
scripts/
  fetch-buskool-base-data.mjs   # کراول APIهای عمومی باسکول → JSON
  seed-base-data.mjs            # اینزرت JSONها در Atlas (upsert)
  data/                         # خروجی کراول (categories/provinces/cities)
```

> `.env` از نمونه `.env.example` ساخته می‌شود و هرگز commit نمی‌شود.
