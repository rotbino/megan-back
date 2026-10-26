# Megan (iMach) — بک‌اند مارکت‌پلیس B2B عمده‌فروشی

**NestJS 12 + Fastify 5 + Prisma 6 + MongoDB Atlas** — آگهی‌ها عین ساختار باسکول (id عددی،
فیلدهای snake_case)، مدیریت فایل چندریختی با دکترین imach-back (staging + reaper + replace)،
لوکیشن درختی واحد (استان/شهر/منطقه/محله در یک کالکشن با type).

## اجرا — گام به گام (ویندوز / لینوکس / مک)

> **پیش‌نیاز:** Node.js نسخه **LTS 22** (پرایسما روی نسخه‌های خیلی جدید مثل 26 هنوز رسمی
> پشتیبانی نمی‌شود). همه دستورات زیر را در روت ریپو (`megan-back`) اجرا کنید.
> در PowerShell نیازی به sudo نیست؛ در لینوکس/مک اگر npm به‌صورت global نصب شده با sudo بزنید.

```powershell
# ۱) نصب وابستگی‌ها (npm که همراه Node نصب است — یا yarn)
npm install

# ۲) تولید کلاینت Prisma
#    (کلید PRISMA_ENGINES_MIRROR از قبل داخل .env هست — بدون آن در ایران
#     خطای ECONNRESET موقع دانلود موتورها می‌گیرید. اگر باز هم خطا داد،
#     قبل از دستور در PowerShell بزنید:  $env:PRISMA_ENGINES_MIRROR="https://registry.npmmirror.com/-/binary/prisma")
npm run db:generate

# ۳) اعمال اسکیما روی Atlas (کالکشن‌ها + ایندکس‌ها)
npm run db:push
# اگر Prisma هشدار data-loss داد (مثلاً موقع تغییر مدل‌ها) و مطمئنید داده seed است:
#   npm run db:push -- --accept-data-loss

# ۴) seed داده‌های پایه — ۶۹۵ دسته + ۳۱ استان + ۴۷۴ شهر (id باسکول)
npm run seed:base-data

# ۵) (اختیاری) seed ۶۰ آگهی واقعی باسکول + انتقال عکس‌ها به آروان
npm run seed:products
# فقط برای دیتابیس خالی لازم است — الان دیتای Atlas از قبل seed شده.

# ۶) اجرای سرور توسعه (خودکار ری‌استارت با هر تغییر کد)
npm run dev
# یا بیلد و اجرای پروداکشن:
#   npm run build ; npm start
```

**نتیجه:**
- API: `http://localhost:4000/api/v1`
- Swagger: `http://localhost:4000/docs`
- سلامت سرویس: `GET http://localhost:4000/api/v1/health` → `{"status":true,"data":{"db":"up"}}`

تست دستی سریع (ساده‌ترین راه: همین آدرس‌ها را در مرورگر باز کنید):

```powershell
# PowerShell — تست سلامت و ارسال OTP (کد dev در پاسخ برمی‌گردد)
Invoke-RestMethod http://localhost:4000/api/v1/health
Invoke-RestMethod -Method Post http://localhost:4000/api/v1/auth/sendOtp -ContentType 'application/json' -Body '{"phone":"09123456789"}'
Invoke-RestMethod -Method Post http://localhost:4000/api/v1/locations/getAllProvinces -ContentType 'application/json' -Body '{}'

# در bash/cmd (نه PowerShell):
curl -X POST http://localhost:4000/api/v1/auth/sendOtp -H 'Content-Type: application/json' -d '{"phone":"09123456789"}'
```

### عیب‌یابی اتصال به Atlas

اگر `db:push` یا `seed` با timeout/اتصال خطا داد:
1. در پنل Atlas → **Network Access** باید IP شما مجاز باشد (برای توسعه `0.0.0.0/0`).
2. رشته اتصال در `.env` (متغیر `DATABASE_URL`) باید همان کلاستر MeganCluster باشد — کلیدها
   همیشه از همین فایل روت خوانده می‌شود (هم `env.ts` هم همه اسکریپت‌ها با override).
3. اگر اینترنت شما پورت ۲۷۰۱۷ را می‌بندد، از اینترنت دیگری امتحان کنید.

### چرا `.env` در روت و track شده؟

مالک ریپو انتخاب کرده کلیدها داخل `.env` روت باشند و در گیت بمانند (هر دو اپ و همه
اسکریپت‌ها فقط از همان‌جا می‌خوانند — هیچ کلیدی در کد نیست). مزیت: روی سرور هم کافی است
همین فایل باشد یا متغیرهای محیطی هم‌نام ست شوند؛ `env.ts` در بوت fail-fast اعتبارسنجی می‌کند.

## ساختار

```
src/
  common/       env (fail-fast، فقط از .env روت) · PrismaService (گرم‌کردن بوت) · کش تگ‌دار LRU · فیلتر خطا · گاردها
  auth/         sendOtp · verifyOtp · refreshToken · logout — OTP هش‌شده + JWT + رفرش چرخشی
  users/        getProfile · updateProfile · getUserByPhone
  categories/   getAllCategories · getCategoriesByParent — درخت باسکول (id عددی)
  locations/    getAllProvinces · getCitiesByProvince · getLocationsByParent — درخت لوکیشن واحد
  uploads/      uploadImage · getFileUrl · deleteImage + ادمین (عروسک/مصرف) — پورت imach-back
  products/     getProductList · getProductById · createProduct · getMyProducts · getSeller · …
  buy-requests/ درخواست‌های خرید + CRM نشان‌شده‌ها
  verification/ احراز هویت اسناد (کارت ملی + سلفی)
  chat/         گفتوگوها — REST + WebSocket (socket.io)
scripts/        seedها · db-push.mjs (کراس‌پلتفرم) · test-*.mjs (تست سرتاسری)
docs/           IMPLEMENTATION.md — نقشه راه فاز به فاز (زنده)
prisma/         schema.prisma — لوکیشن درختی واحد + File چندریختی + آگهی‌های باسکول
```

## قرارداد پاسخ

```
موفق:  { "status": true,  "data": {...}, "message": "…" }
خطا:   { "status": false, "message": "پیام فارسی", "code": "OTP_WRONG" }
```

اندپوینت‌ها خوانا و فعلی (اکثراً POST) — مستندات کامل در Swagger `/docs`.

## نکته‌های حیاتی

- **لوکیشن درختی واحد:** یک کالکشن `Location` با type (province/city/region/…) — کلید
  ترکیبی «province:4» چون id های عددی باسکول استان و شهر از دو فضای جدا هستند و برخورد
  دارند (شهر ۴=بستان‌آباد، استان ۴=اصفهان). API همان id عددی خام را برمی‌گرداند.
- **id عددی باسکول** برای دسته/لوکیشن/آگهی؛ id جدید محصولات از جدول `Counter`.
- **درون‌ریزی مستقیم با درایور خام:** فیلدهای ObjectId باید ObjectId واقعی باشند نه رشته.
- **فایل‌ها:** جدول `File` چندریختی — relatedId رشته؛ reaper فایل‌های staged منقضی را
  حذف می‌کند؛ replace اول آپلود می‌کند بعد قبلی را پاک می‌کند.
- سند کامل: `docs/IMPLEMENTATION.md`
