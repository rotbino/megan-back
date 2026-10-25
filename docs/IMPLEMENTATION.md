# سند پیاده‌سازی ایمچ (Megan) — نقشه راه فاز به فاز

> **سند زنده است:** بعد از تکمیل و تست هر فاز، چک‌باکس همان فاز تیک می‌خورد و `commit + push` انجام می‌شود.
> **قانون:** هر فاز باید به‌تنهایی قابل اجرا و بدون خطا باشد تا همیشه یک نسخه سالم قابل نمایش وجود داشته باشد.

---

## ۰. اصول طلایی (هرگز عوض نمی‌شود)

1. **UX، فلو و متن‌ها عین باسکول** — برند ایمچ فقط در رنگ و لعاب ظاهری متفاوت است.
2. **سرعت، SEO و کش** در درجه اول اهمیت‌اند — هم سمت سرور، هم سمت کلاینت.
3. **کد ماژولار و ساده** — هیچ پیچیدگی خودساخته؛ هزینه توسعه‌های بعدی باید حداقل بماند.
4. **نام‌گذاری اندپوینت‌ها خوانا و فعلی** (مثل `getUserByPhone`، `getProfile`) — نه قرارداد REST استاندارد. اکثر اندپوینت‌ها **POST** هستند.
5. **تنها قابلیت تبلیغاتی: نردبان** (۱۰۰٬۰۰۰ تومان / ماه / محصول). عضویت VIP و «فروشنده ویژه» نداریم.
6. ورود فقط با **موبایل + کد ۵ رقمی OTP** (مثل باسکول) — بدون رمز عبور.
7. هر فاز: پیاده‌سازی → تست → commit → push → تیک این سند.

---

## ۱. معماری کلی

| لایه | پشته | محل |
|---|---|---|
| فرانت | Next.js 16 (App Router) + Tailwind 4 + React Query | `github.com/rotbino/megan-web` — اجرای dev از اپ کاری روی پورت 3000 |
| بک | NestJS 11 + Fastify 5 + Mongoose 8 | `github.com/rotbino/megan-back` — پورت **4000** |
| دیتابیس | **MongoDB Atlas** — کلاستر MeganCluster، دیتابیس `megan_online_db` | رشته اتصال در `.env` (متغیر `DATABASE_URL`) |
| اشیا/تصاویر | ArvanCloud Object Storage (سازگار S3) — باکت `daymatfilles`، ریجن `ir-thr-at1` | کلیدها در `.env` (ARVAN_*) |
| پوش نوتیفیکیشن | Web Push استاندارد باز با کلیدهای VAPID | `.env` (VAPID_*) |
| مستندات API | Swagger در مسیر `/docs` (فقط در development) | `SWAGGER_ENABLED` |

**احراز هویت:** OTP ۵ رقمی با TTL ۲ دقیقه → ساخت/یافتن کاربر → توکن دسترسی JWT (۷ روز، `JWT_EXPIRES_IN`) + رفرش‌توکن چرخشی (۳۰ روز، هش‌شده sha256 در دیتابیس با TTL خودکار).

**کش:**
- سرور: `CacheService` درون‌حافظه با TTL برای داده‌های پایه کم‌تغییر (دسته‌ها، استان‌ها، شهرها). در محیط چند-نمونه‌ای بعداً با Redis جایگزین می‌شود (اینترفیس `wrap/​invalidate` ثابت می‌ماند).
- کلاینت: React Query با `staleTime/gcTime` بر اساس نوع داده (بخش ۴).

---

## ۲. استانداردهای بک‌اند — در هر فاز رعایت شود

### ساختار
- هر ماژول یک فولدر تخت: `module.ts` / `controller.ts` / `service.ts` / `dto.ts` / `schemas.ts`.
- ماژول‌ها فقط از طریق سرویس‌های export‌شده همدیگر را صدا می‌زنند (نه مستقیم مدل دیگری).
- `CommonModule` سراسری: `CacheService`، گارد JWT، فیلتر خطای یکسان، دیکوریتر کاربر جاری.

### قرارداد پاسخ (یکنواخت در کل API)
```
موفق:  { "status": true,  "data": {...}, "message": "..." (اختیاری) }
خطا:   { "status": false, "message": "پیام فارسی برای کاربر", "code": "OTP_WRONG" (اختیاری) }
```
- پیام خطا همیشه فارسی و قابل نمایش به کاربر باشد؛ `code` برای منطق فرانت.

### نام‌گذاری اندپوینت‌ها
- **فعل + موضوع** به camelCase؛ بیشتر POST. مثال‌های الگو:
  `sendOtp`، `verifyOtp`، `refreshToken`، `getProfile`، `updateProfile`، `getUserByPhone`، `getAllCategories`، `getCategoriesByParent`، `getAllProvinces`، `getCitiesByProvince`، و در فازهای بعد: `createProduct`، `getProductList`، `getProductById`، `sendMessage`، `getConversations`…
- فقط `/health` استثناً GET است (مانیتورینگ آپ‌تایم).

### اعتبارسنجی و امنیت
- **DTO با class-validator برای همه ورودی‌ها** (whitelist: ورودی ناشناس حذف می‌شود).
- `@fastify/helmet` (هدرهای امنیتی)، CORS از `CORS_ORIGINS`، `@fastify/compress` (gzip/brotli برای سرعت).
- رفرش‌توکن فقط به‌صورت هش sha256 ذخیره می‌شود؛ OTP هم هش (sha256(phone+code)).
- Rate limit روی `sendOtp`: حداکثر ۳ کد در ۱۰ دقیقه برای هر شماره (در B11 سراسری می‌شود).
- `enableShutdownHooks` (graceful shutdown) و اعتبارسنجی فوری env هنگام بوت.

### دیتابیس (MongoDB)
- نام فیلدها **snake_case منطبق با باسکول** (`product_name`, `min_sale_price`, `province_id`…) تا مهاجرت/مقایسه داده بی‌دردسر باشد.
- برای داده‌های پایه seed‌شده از باسکول، `_id` همان عدد باسکول است (پسته=44، اصفهان=4، شهر بابک=230) تا فرانت بدون تغییر سوییچ کند.
- ایندکس‌های الزامی: `users.phone` (unique)، `users.user_name` (unique sparse)، `categories(parent_id, kind, score)`، `cities(province_id)`، TTL روی `otp_codes.expires_at` و `refresh_tokens.expires_at`، و ایندکس‌های ترکیبی لیست‌ها در فاز محصولات.
- کوئری‌های لیست: همیشه `.lean()` + projection + صفحه‌بندی (payload پاسخ هرگز مثل باسکول ۲.۶MB نمی‌شود).
- حذف نرم با فیلد وضعیت (مثل `status: DELETED` محصولات) — سابقه تجاری حفظ می‌شود.

### سرعت
- داده‌های پایه فقط از کش سرو می‌شوند (TTL ۱۰ دقیقه).
- اتصال Mongoose با pool پیش‌فرض Atlas؛ `maxPoolSize` فقط در صورت نیاز تنظیم می‌شود.
- `NODE_ENV=development` → کد OTP در پاسخ `sendOtp` برمی‌گردد (`devCode`) برای تست بدون پنل پیامک.

---

## ۳. استانداردهای فرانت — در هر فاز رعایت شود

1. **React Query** برای تمام دیتای API: `staleTime` بر اساس نوع داده (دسته‌ها/استان‌ها: ۶ ساعت، لیست‌ها: ۳۰ ثانیه، پروفایل: ۵ دقیقه)؛ `placeholderData: keepPreviousData` برای صفحه‌بندی نرم؛ کلید کوئری استاندارد `[module, action, params]`.
2. **SSR / ISR** برای همه صفحات عمومی سئو-پذیر: لیست محصولات، جزئیات آگهی، پروفایل کسب‌وکار، درخواست‌های خرید — Server Components + `revalidate` مناسب. صفحات پنل و ورود `noindex`.
3. **URLهای خوانا و سئو-پذیر** مثل باسکول: `/product-list/category/پسته`، `/product-view/{slug}/{category}/{id}`، `/profile/{username}` + canonical + OG/Twitter + JSON-LD (Product، BreadcrumbList، WebSite+SearchAction).
4. **next/image برای همه تصاویر** با `remotePatterns` دامنه‌های ArvanCloud (و CDN باسکول تا وقتی عکس ماک داریم)؛ `sizes` ریسپانسیو؛ `priority` فقط برای تصویر LCP اول صفحه.
5. **پروکسی API**: rewrite نکست `/api/**` → `http://localhost:4000/**` — بدون CORS، هم‌مبدأ، و در پروداکشن هم فقط آدرس بک عوض می‌شود.
6. **پرفورمنس**: dynamic import کامپوننت‌های سنگین (مگامنو، چت، ویزارد)، bundle سبک، فونت با next/font محلی (IRANSans موجود)، بدون overflow افقی در 390px، نوار پایین موبایل اپ‌گونه.
7. **SEO فنی**: `sitemap.ts` داینامیک از دیتابیس، `robots.ts`، متادیتای یکتا هر صفحه، عنوان‌های مطابق الگوی باسکول («خرید و قیمت {کالا} عمده | ارزان‌ترین قیمت»).
8. سینک جریان توسعه فرانت: ریپو → `cp` به اپ کاری → تست مرورگر → commit/push ریپو.

---

## ۴. داده‌های پایه (Seed) — منبع: باسکول

دیتای واقعی از **APIهای عمومی خود باسکول** گرفته و در مونگو Atlas اینزرت می‌شود؛ اسکریپت‌ها در فولدر `scripts/` نگهداری و پوش می‌شوند:

| اسکریپت | کار |
|---|---|
| `scripts/fetch-buskool-base-data.mjs` | کراول `POST /get_category_list` (BFS کل درخت) + `POST /location/get_location_info` (استان‌ها و شهرها) → ذخیره JSON خام در `scripts/data/` |
| `scripts/seed-base-data.mjs` | آپسرت JSONها در کالکشن‌های `categories` / `provinces` / `cities` (با `_id` عددی باسکول + trim نام شهرها) |

- اجرای کامل: `bun run seed:base-data`
- نکته: نام شهرها در API باسکول فاصله ابتدایی دارد → هنگام seed تریم می‌شود.
- اجرای مجدد seed ایمن است (upsert؛ داده دستی‌ساخته حذف نمی‌شود).
- هر وقت باسکول داده جدید گذاشت، دوباره اجرا شود.

---

## ۵. فازهای بک‌اند

- [x] **B0 — زیرساخت پروژه:** NestJS + Fastify + Mongoose (اتصال Atlas) + Config + Swagger + helmet/compress/CORS + فیلتر خطای یکسان + `/health` + حذف Prisma (مهاجرت به مونگو).
- [x] **B1 — احراز هویت:** `sendOtp` / `verifyOtp` / `refreshToken` / `logout` — OTP هش‌شده با TTL، rate limit ۳/۱۰دقیقه، JWT دسترسی + رفرش چرخشی هش‌شده، `devCode` در development.
- [x] **B2 — کاربران:** `getProfile` / `updateProfile` (نام، جنسیت، نقش خریدار/فروشنده، درباره کسب‌وکار، پروفایل کامل embedded مثل myuser_profiles باسکول) / `getUserByPhone` (عمومی و حداقلی) + تولید `user_name` عمومی رندوم مثل باسکول.
- [x] **B3 — داده‌های پایه:** کراول کامل درخت دسته‌ها + ۳۱ استان + همه شهرها از APIهای باسکول → seed در Atlas + اندپوینت‌های `getAllCategories` / `getCategoriesByParent` / `getAllProvinces` / `getCitiesByProvince` همه با کش ۱۰ دقیقه‌ای.
- [ ] **B4 — آپلود تصاویر (ArvanCloud):** `uploadImage` (multipart) → اعتبارسنجی jpeg/jpg/png، حداکثر ۵MB، حداقل ۲۰KB (قواعد باسکول) → کلید `{folder}/{yyyy}/{mm}/{uuid}.jpg` → آپلود S3-compatible → برگرداندن URL عمومی.
- [ ] **B5 — محصولات:** ثبت ۶ مرحله‌ای (دسته/نوع/قیمت و موجودی/عکس/توضیحات/جزئیات) + `getProductList` (فیلتر دسته+استان+شهر+جستجو، مرتب‌سازی «مرتبط‌ترین»=نردبان اول / «جدیدترین»، صفحه‌بندی cursor) + `getProductById` + وضعیت‌های PENDING/CONFIRMED/REJECTED/DELETED + جزئیات نهایی key-value + `is_ladder` denorm برای سورت سریع.
- [ ] **B6 — پروفایل کسب‌وکار و احراز هویت:** تکمیل پروفایل پنل (شرکت/حقیقی، آدرس، شبا…) + ارسال مدارک (کارت ملی+سلفی) + جریان تأیید ادمین.
- [ ] **B7 — درخواست‌های خرید (RFQ) + خریداران:** ثبت RFQ با «نوع کالا» + لیست عمومی درخواست‌ها + پیشنهادی‌ها (تطبیق نوع کالا/دسته) + CRM «نشان شده‌ها» (لیست‌ها، وضعیت ۷گانه، یادداشت زمان‌دار).
- [ ] **B8 — چت و پیام‌ها:** مکالمه خریدار/فروشنده روی آگهی (WebSocket) + لیست مکالمات + خوانده‌شدن.
- [ ] **B9 — کیف پول و نردبان:** شارژ کارت‌به‌کارت (۳ پکیج: ۱۰۰هزار بدون بونوس / ۲۰۰هزار +۱۰٪ / ۴۰۰هزار +۲۰٪) — کاربر تصویر فیش را می‌فرستد → `ChargeOrder` با وضعیت PENDING → تأیید/رد در پنل ادمین (با adminNote) → افزودن `charge_amount` به `wallet_balance`. نردبان: هر محصول برای **یک ماه (۳۰ روز) ۱۰۰٬۰۰۰ تومان**، هزینه از کیف پول کسر می‌شود (حداقل شارژ ۱۰۰هزار)؛ `months=1` در v1، `total_price = months × monthly_price`؛ `is_ladder` denorm روی محصول برای سورت سریع + انقضای خودکار.
- [ ] **B10 — وب‌پوش:** ثبت subscription با VAPID + ارسال نوتیف (پیام جدید، تغییر قیمت، انقضای آگهی).
- [ ] **B11 — سخت‌سازی نهایی:** rate limit سراسری، تعویض کش با Redis (اختیاری)، لاگ ساختاریافته pino، مانیتورینگ و بکاپ.

## ۶. فازهای فرانت

- [ ] **F1 — زیرساخت API واقعی:** کلاینت fetch مرکزی + rewrite `/api/**` → پورت 4000 + React Query Provider تنظیم‌شده + تعویض تدریجی `lib/mock/api.ts` (ابتدا: دسته‌ها، استان/شهر، سپس auth واقعی OTP) — ماک فقط به‌عنوان fallback dev.
- [ ] **F2 — صفحات عمومی با دیتای زنده + SSR/ISR:** لیست محصولات، جزئیات آگهی، درخواست‌های خرید، پروفایل کسب‌وکار — Server Components + revalidate + متادیتا/JSON-LD کامل + sitemap داینامیک.
- [ ] **F3 — تصاویر:** next/image همه‌جا + remotePatterns آروان + sizes ریسپانسیو + priority برای LCP.
- [ ] **F4 — پنل به API زنده:** ورود OTP واقعی، پنل فروشنده/خریدار، ویزارد ثبت محصول با آپلود واقعی، نردبان و کیف پول.
- [ ] **F5 — پرفورمنس و کش نهایی:** ممیزی bundle، Lighthouse ≥ ۹۰ (Performance/SEO)، prefetch لینک‌های داخلی، بستن همه مورد‌های Core Web Vitals.

---

## ۷. چک‌لیست یادآور هر زیرفاز (قبل از commit چک شود)

**بک‌اند:**
- [ ] DTO + class-validator برای همه ورودی‌ها؟
- [ ] پاسخ یکنواخت `{status, data|message}`؟ پیام فارسی؟
- [ ] ایندکس مناسب برای کوئری‌های جدید؟ `.lean()` در لیست‌ها؟
- [ ] اگر داده پایه است → کش با TTL؟
- [ ] اندپوینت با توکن گارد شده؟ (اگر داده شخصی است)
- [ ] تست curl انجام شد؟ لاگ خطا خواناست؟

**فرانت:**
- [ ] صفحه عمومی است یا پنل؟ (SSR/ISR در برابر کلاینت + noindex)
- [ ] متادیتا/canonical/OG/JSON-LD؟
- [ ] next/image به‌جای img خام؟
- [ ] staleTime مناسب نوع داده؟ placeholderData صفحه‌بندی؟
- [ ] موبایل 390px بدون overflow؟
- [ ] URL خوانا و سئو-پذیر؟

---

## ۸. متغیرهای محیطی (`.env`)

| کلید | کاربرد |
|---|---|
| `PORT` / `HOST` | پورت و آدرس سرویس (4000 / 0.0.0.0) |
| `NODE_ENV` | development / production |
| `DATABASE_URL` | رشته اتصال MongoDB Atlas |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | امضا و عمر توکن دسترسی |
| `REFRESH_TOKEN_TTL_DAYS` | عمر رفرش‌توکن (۳۰ روز) |
| `CORS_ORIGINS` | مبدأهای مجاز (`*` = همه) |
| `SWAGGER_ENABLED` | مستندات /docs |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push |
| `ARVAN_ENDPOINT` / `ARVAN_REGION` / `ARVAN_ACCESS_KEY` / `ARVAN_SECRET_KEY` / `ARVAN_BUCKET_NAME` | Object Storage تصاویر |

> `.env` طبق انتخاب مالک ریپو در گیت track می‌شود (شامل کلیدهای Atlas/Arvan/VAPID). اگر ریپو عمومی شد، حتماً از tracking خارج و چرخانده شود. الگوی کلیدها در `.env.example`.

---

## ۹. اجرا و تست

```bash
# بک‌اند (از ریپو)
cd repos/megan-back
bun install
bun run build
node dist/main.js          # → http://localhost:4000  (Swagger: /docs)

# seed داده‌های پایه از باسکول
bun run seed:base-data

# تست دستی
curl http://localhost:4000/health
curl -X POST http://localhost:4000/auth/sendOtp -H 'Content-Type: application/json' -d '{"phone":"09123456789"}'
# → devCode در development برمی‌گردد
curl -X POST http://localhost:4000/auth/verifyOtp -H 'Content-Type: application/json' -d '{"phone":"09123456789","code":"12345"}'
# → accessToken + refreshToken
curl -X POST http://localhost:4000/users/getProfile -H 'Authorization: Bearer <token>'
```

فرانت dev از اپ کاری روی پورت 3000 اجرا می‌شود؛ بعد از F1 درخواست‌های `/api/**` آن به همین سرویس پروکسی می‌شوند.

---

## ۱۰. تاریخچه فازها

| فاز | وضعیت | تاریخ |
|---|---|---|
| B0 زیرساخت | ✅ انجام شد | ۱۴۰۵/۰۸/۰۴ |
| B1 احراز هویت | ✅ انجام شد | ۱۴۰۵/۰۸/۰۴ |
| B2 کاربران | ✅ انجام شد | ۱۴۰۵/۰۸/۰۴ |
| B3 داده‌های پایه | ✅ انجام شد | ۱۴۰۵/۰۸/۰۴ |
