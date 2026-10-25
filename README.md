# Megan (iMach) — بک‌اند مارکت‌پلیس B2B عمده‌فروشی

**NestJS 12 + Fastify 5 + Prisma 6 + MongoDB Atlas** — آگهی‌ها عین ساختار باسکول (id عددی،
فیلدهای snake_case)، مدیریت فایل چندریختی با دکترین imach-back (staging + reaper + replace).

## اجرا

```bash
bun install
bunx prisma generate
bash scripts/db-push.sh        # اسکیما + ایندکس‌ها (override صریح DATABASE_URL)
bun run seed:base-data         # ۶۹۵ دسته + ۳۱ استان + ۴۷۴ شهر از باسکول
bun run seed:products          # ۲۶ فروشنده + ۶۰ آگهی واقعی + rehost عکس‌ها در آروان
bun run build
node dist/main.js              # → http://localhost:4000  |  Swagger: /docs
```

## ساختار

```
src/
  common/       env (fail-fast) · PrismaService (گرم‌کردن بوت) · کش تگ‌دار LRU · AppError · فیلتر خطا · گاردها
  auth/         sendOtp · verifyOtp · refreshToken · logout — OTP هش‌شده + JWT + رفرش چرخشی
  users/        getProfile · updateProfile · getUserByPhone
  categories/   getAllCategories · getCategoriesByParent — درخت باسکول (id عددی)
  locations/    getAllProvinces · getCitiesByProvince
  uploads/      uploadImage · getFileUrl · deleteImage + ادمین (عروسک/مصرف) — پورت imach-back
  products/     getProductList · getProductById · createProduct · getMyProducts · getSeller · …
scripts/        seedها · fetch از باسکول · db-push.sh · db-drop-all.mjs · test-api.mjs
docs/           IMPLEMENTATION.md — نقشه راه فاز به فاز (زنده)
```

## قرارداد پاسخ

```
موفق:  { "status": true,  "data": {...}, "message": "…" }
خطا:   { "status": false, "message": "پیام فارسی", "code": "OTP_WRONG" }
```

اندپوینت‌ها خوانا و فعلی (اکثراً POST) — مستندات کامل در Swagger `/docs`.

## نکته‌های حیاتی

- **id عددی باسکول** برای دسته/استان/شهر/آگهی (Prisma روی مونگو id صریح عددی)؛ id جدید
  محصولات از جدول `Counter`.
- **درون‌ریزی مستقیم با درایور خام:** فیلدهای ObjectId (user_id/owner_id) باید ObjectId
  واقعی باشند نه رشته (seed دارای fixer).
- **فایل‌ها:** جدول `File` چندریختی — relatedId رشته (ObjectUserId کاربر یا عدد آگهی)؛
  reaper هر ۶ ساعت stagedهای منقضی را با بایت‌هایشان حذف می‌کند؛ replace اول آپلود
  می‌کند بعد قبلی را پاک می‌کند.
- سند کامل: `docs/IMPLEMENTATION.md`
