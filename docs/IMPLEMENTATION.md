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
6. ورود فقط با **موبایل + کد ۴ رقمی OTP** (مثل باسکول) — بدون رمز عبور. تا
   رسیدن پنل پیامک، کد ثابت **1234** از `OTP_FIXED_CODE` در `.env` صادر می‌شود؛
   با آمدن پنل، این کلید خالی می‌شود و کد تصادفی واقعی می‌رود.
7. هر فاز: پیاده‌سازی → تست → commit → push → تیک این سند.
8. **دیتای آگهی‌ها عین ساختار باسکول** (id عددی، فیلدهای snake_case) — دیتای باسکول مستقیم seed می‌شود.
9. **مدیریت فایل عین imach-back** — جدول File چندریختی + نظم ضد-سرگردان (بخش ۵).

---

## ۱. معماری کلی

| لایه | پشته | محل |
|---|---|---|
| فرانت | Next.js 16 (App Router) + Tailwind 4 + React Query | `github.com/rotbino/megan-web` — اجرای dev از اپ کاری روی پورت 3000 |
| بک | **NestJS 12 + Fastify 5 + Prisma 6 (Mongoose حذف شد)** | `github.com/rotbino/megan-back` — پورت **4000** |
| دیتابیس | **MongoDB Atlas** — کلاستر MeganCluster، دیتابیس `megan_online_db` | رشته اتصال در `.env` (متغیر `DATABASE_URL`) |
| اشیا/تصاویر | ArvanCloud Object Storage (سازگار S3) — باکت `daymatfilles`، ریجن `ir-thr-at1` | کلیدها در `.env` (ARVAN_*) |
| پوش نوتیفیکیشن | Web Push استاندارد باز با کلیدهای VAPID | `.env` (VAPID_*) |
| مستندات API | Swagger در مسیر `/docs` | `SWAGGER_ENABLED` |

**میراث imach-back (بک‌اند کنارگذاشته‌شده):** معماری Prisma+Fastify، ماژول files چندریختی با
reaper/replace/staging، PrismaService با کوئری گرم‌کردن بوت، کش تگ‌دار، env فیل‌fast،
خواندن multipart با parts() (ترتیب‌مستقل فیلدها). مطالعه‌شده و پورت‌شده در R3.

**احراز هویت:** OTP ۴ رقمی با TTL ۲ دقیقه (هش sha256؛ فعلاً کد ثابت 1234 از
`OTP_FIXED_CODE` تا رسیدن پنل پیامک) → ساخت/یافتن کاربر (user_name عمومی
مثل باسکول هنگام ثبت‌نام تولید می‌شود) → توکن دسترسی JWT (۷ روز) + رفرش‌توکن چرخشی
(۳۰ روز، هش‌شده). پاک‌سازی OTP/RefreshToken منقضی با reaper دوره‌ای (Prisma TTL ایندکس ندارد).

**کش:**
- سرور: `CacheService` درون‌حافظه با TTL + **ابطال تگ‌دار** + LRU (۵۰۰۰) — پرایسریس با
  کوئری گرم‌کردن در بوت (اولین درخواست کاربر هرگز ۲ ثانیه کشف توپولوژی نمی‌کشد).
  برای مقیاس افقی بعداً با Redis جایگزین می‌شود (اینترفیس ثابت می‌ماند).
- کلاینت: React Query با `staleTime/gcTime` بر اساس نوع داده (بخش ۶).

**نرخ درخواست:** Throttler سراسری ۳۰۰ req/min/IP + کنترلر auth سخت‌تر (۱۵/min) + سقف
۳ کد OTP در ۱۰ دقیقه برای هر شماره.

---

## ۲. استانداردهای بک‌اند — در هر فاز رعایت شود

### ساختار
- هر ماژول یک فولدر تخت: `module.ts` / `controller.ts` / `service.ts` / `dto.ts`.
- ماژول‌ها فقط از طریق سرویس‌های export‌شده همدیگر را صدا می‌زنند.
- `CommonModule` سراسری: PrismaService + CacheService؛ `AuthModule`: JwtModule + گارد.

### قرارداد پاسخ (یکنواخت در کل API)
```
موفق:  { "status": true,  "data": {...}, "message": "..." (اختیاری) }
خطا:   { "status": false, "message": "پیام فارسی برای کاربر", "code": "OTP_WRONG" (اختیاری) }
```
- پیام خطا همیشه فارسی و قابل نمایش؛ `code` برای منطق فرانت.
- اعتبارسنجی: `fields` آرایه پیام‌ها اضافه می‌شود.

### نام‌گذاری اندپوینت‌ها
- **فعل + موضوع** به camelCase؛ اکثراً POST. الگوهای موجود:
  `sendOtp`، `verifyOtp`، `refreshToken`، `logout`، `getProfile`، `updateProfile`،
  `getUserByPhone`، `getAllCategories`، `getCategoriesByParent`، `getAllProvinces`،
  `getCitiesByProvince`، `uploadImage`، `getFileUrl`، `deleteImage`، `createProduct`،
  `getProductList`، `getProductById`، `getRelatedProducts`، `getMyProducts`،
  `deleteMyProduct`، `getSeller`، `searchSuggestions` — و در ادامه:
  `createBuyRequest`، `getBuyRequestList`، `sendMessage`، `getConversations`…
- فقط `/health` استثناً GET است (مانیتورینگ).

### اعتبارسنجی و امنیت
- DTO با class-validator برای همه ورودی‌ها (whitelist: ورودی ناشناس حذف می‌شود).
- helmet با **CORP cross-origin** (عکس‌های عمومی آروان از دامنه دیگر سرو می‌شوند)،
  CORS از `CORS_ORIGINS`، compress (gzip/brotli).
- رفرش‌توکن و OTP فقط به‌صورت هش sha256 ذخیره می‌شوند.
- bodyLimit محاسبه‌شده از MAX_FILE_SIZE؛ multipart با `parts()` (ترتیب‌مستقل).

### دیتابیس (MongoDB + Prisma)
- نام فیلدها **snake_case عین باسکول** با `@map` — `product_name`، `min_sale_price`، `province_id`…
- **id عددی باسکول** برای داده‌های seed: `Int @id` با مقدار صریح (پسته=44، اصفهان=4،
  آگهی=284241). id محصولات جدید از جدول `Counter` با increment اتمیک (شروع ۳ میلیون).
- User/OtpCode/RefreshToken/File با ObjectId عادی.
- ⚠️ **درج مستقیم با درایور خام**: فیلدهای ObjectId (مثل `user_id`/`owner_id`) باید
  به‌صورت ObjectId واقعی نوشته شوند نه رشته — seed دارای fixer است.
- ایندکس‌ها در خود اسکیمای Prisma (`@@index`) — با `npm run db:push` (`scripts/db-push.mjs`،
  کراس‌پلتفرم node، override صریح DATABASE_URL برای محیط‌هایی که از قبل ست دارند).
- حذف نرم با `status: DELETED` — سابقه تجاری حفظ می‌شود.
- TTL ایندکس در Prisma پشتیبانی نمی‌شود → پاک‌سازی با reaper دوره‌ای.

### سرعت
- داده‌های پایه فقط از کش تگ‌دار سرو می‌شوند (TTL ۱۰ دقیقه).
- PrismaService با گرم‌کردن بوت (کالکشن‌های مسیر داغ).
- لیست‌ها: همیشه projection سبک + صفحه‌بندی (payload هرگز ۲.۶MB نمی‌شود مثل باسکول).
- عکس‌ها: URL عمومی مستقیم از CDN آروان با `Cache-Control: immutable` — بدون پروکسی.
- `NODE_ENV=development` → کد OTP در پاسخ `sendOtp` برمی‌گردد (`devCode`).

---

## ۳. استانداردهای فرانت — در هر فاز رعایت شود

1. **React Query** برای تمام دیتای API: `staleTime` بر اساس نوع داده (دسته‌ها/استان‌ها:
   ۶ ساعت، لیست‌ها: ۳۰ ثانیه، پروفایل: ۵ دقیقه)؛ `placeholderData: keepPreviousData`
   برای صفحه‌بندی نرم؛ کلید کوئری استاندارد `[module, action, params]`.
2. **SSR / ISR** برای همه صفحات عمومی سئو-پذیر: لیست محصولات، جزئیات آگهی، پروفایل
   کسب‌وکار، درخواست‌های خرید — Server Components + `revalidate` مناسب. صفحات پنل و ورود `noindex`.
3. **URLهای خوانا و سئوپذیر** مثل باسکول: `/product-list/category/پسته`،
   `/product-view/{slug}/{category}/{id}`، `/profile/{username}` + canonical + OG/Twitter
   + JSON-LD (Product، BreadcrumbList، WebSite+SearchAction).
4. **next/image برای همه تصاویر** با `remotePatterns` دامنه آروان؛ تامبنیل ۴۰۰px در
   کارت‌های لیست و تصویر اصلی ۱۶۰۰px در صفحه جزئیات؛ `priority` فقط برای LCP اول.
5. **پروکسی API**: rewrite نکست `/api/**` → `http://localhost:4000/api/v1/**` — بدون CORS،
   هم‌مبدأ؛ در پروداکشن فقط آدرس بک عوض می‌شود.
6. **پرفورمنس**: dynamic import کامپوننت‌های سنگین (مگامنو، چت، ویزارد)، فونت محلی
   IRANSans با next/font، بدون overflow افقی در 390px، نوار پایین موبایل اپ‌گونه.
7. **SEO فنی**: `sitemap.ts` داینامیک از دیتابیس، `robots.ts`، متادیتای یکتا، عنوان‌های
   مطابق الگوی باسکول («خرید و قیمت {کالا} عمده | ارزان‌ترین قیمت»).
8. سینک جریان توسعه: ریپو → `cp` به اپ کاری → تست مرورگر → commit/push ریپو.

---

## ۴. داده‌های پایه (Seed) — منبع: باسکول

دیتای واقعی از **APIهای عمومی خود باسکول** گرفته و در مونگو Atlas اینزرت می‌شود؛
اسکریپت‌ها در فولدر `scripts/` نگهداری و پوش می‌شوند:

| اسکریپت | کار |
|---|---|
| `scripts/fetch-buskool-base-data.mjs` | کراول `POST /get_category_list` (BFS کل درخت) + `POST /location/get_location_info` → JSON خام در `scripts/data/` |
| `scripts/seed-base-data.mjs` | آپسرت ۶۹۵ دسته + ۵۰۵ لوکیشن (۳۱ استان + ۴۷۴ شهر) در کالکشن درخت واحد `Location` با کلید ترکیبی «province:4»/«city:230» (trim نام شهرها) |
| `scripts/seed-products.mjs` | ۲۶ فروشنده واقعی + ۶۰ آگهی واقعی (id باسکول) + **rehost عکس‌ها از CDN باسکول به باکت آروان** (پاین‌لاین sharp: اصلی ۱۶۰۰ + تامبنیل ۴۰۰ + هدر immutable) + Counter؛ `--skip-photos` → URL باسکول می‌ماند |
| `scripts/db-drop-all.mjs` | پاک‌سازی کامل (شروع تازه) |
| `scripts/db-push.mjs` | `prisma db push` کراس‌پلتفرم (node) با override صریح DATABASE_URL |
| `scripts/test-locations.mjs` | تست صحت درخت لوکیشن واحد (۱۰ چک: برخورد id ها، والد-فرزند، یکتایی) |

- اجرا: `npm run seed:base-data` سپس `npm run seed:products` (یا bun/yarn — اسکریپت‌ها همه node خالص‌اند)
- اجرای مجدد هر seed ایمن است (upsert + ردشدن rehostهای موجود + fixer ObjectId).
- منبع محصولات: `/home/z/my-project/scripts/buskool-data/products.json` (۶۰ آگهی واقعی ۵ کالا).

---

## ۵. مدیریت فایل — دکترین imach-back (بخش حیاتی)

یک **جدول چندریختی File** تصویر/پیوست هر مدل را تزئین می‌کند:

```
File { ownerId → User, relatedModel: "User"|"Product"|…, relatedId (رشته!), fieldKey: "avatar"|"gallery"|…,
       url (عمومی مستقیم), thumbUrl, storageKey, thumbStorageKey, metadata, size, mimeType }
```

⚠️ `relatedId` **رشته ساده** است (نه ObjectId) — چندریختی: id کاربر ObjectId است ولی
id محصول عدد باسکول؛ هر دو به شکل رشته ذخیره/کوئری می‌شوند.

**نظم ضد-فایل-سرگردان (خواسته مالک — «حافظه گران را هدر نده»):**
1. **Staging + Reaper:** آپلود قبل از وجود مدل (staged, relatedId=null) → اگر تا TTL
   (۷ روز) به مدلی نچسبد، reaper هر ۶ ساعت بایت + ردیفش را حذف می‌کند (idempotent).
2. **Replace اول-آپلود-بعد-حذف:** فایل جدید اول امن می‌شود، بعد قبلی‌های همان اسلات
   حذف می‌شوند — عکس کاربر هیچ‌وقت به‌خاطر خطای آپلود گم نمی‌شود.
3. **بایت‌ها بهترین‌حال:** ردیف DB منبع حقیقت است؛ عروسک دوره‌ای ادمین
   (`listOrphans`/`deleteOrphans`) باقی‌مانده‌های dangling + staged را جمع می‌کند.
4. **پاین‌لاین sharp:** هر تصویر ۲ بار ذخیره می‌شود — اصلی ۱۶۰۰px (q82 mozjpeg) +
   تامبنیل ۴۰۰px (q78) — لیست‌ها تامبنیل می‌کشند (سرعت).
5. **کلید per-entity:** `products/{id}/gallery/{stamp}-{rand}.jpg` — بکاپ/lifecycle بدیهی.
6. **درایور قابل‌سوییچ:** `STORAGE_DRIVER=arvan|local` — یک env، نه بازنویسی.
7. **URL عمومی + Cache-Control immutable** — کش یک‌ساله CDN بدون invalidation.
8. **فرانت فقط لحظه ثبت نهایی آپلود می‌کند** (بعد از createProduct) — نه حدسی وسط فرم.
9. **مصرف per-user** از DB (گروه‌بندی روی ownerId) — بدون اسکن ذخیره‌سازی.

**فرانت (F4):** ویزارد عکس را با objectURL پیش‌نمایش می‌کند → بعد از ثبت موفق محصول،
هر عکس با `uploadImage?model=Product&modelId={id}&key=gallery&replace=false` آپلود می‌شود.

---

## ۶. فازهای بک‌اند (نسخه بازنویسی Prisma)

- [x] **R0 — زیرساخت بازنویسی:** حذف کامل Mongoose → NestJS 12 + Fastify + **Prisma 6** +
  MongoDB Atlas؛ env فیل‌fast؛ PrismaService گرم؛ کش تگ‌دار LRU؛ فیلتر خطای یکسان
  {status, message, code}؛ Throttler سراسری؛ helmet CORP؛ Swagger /docs؛ `/health`.
- [x] **R1 — احراز هویت:** `sendOtp` (rate ۳/۱۰دقیقه، هش، TTL ۲ دقیقه، devCode) /
  `verifyOtp` (ورود/ثبت‌نام یکجا + تولید user_name باسکول‌گونه) / `refreshToken` چرخشی /
  `logout` + reaper پاک‌سازی؛ users: `getProfile`/`updateProfile`/`getUserByPhone`.
- [x] **R2 — داده‌های پایه:** seed ۶۹۵ دسته + ۳۱ استان + ۴۷۴ شهر (id باسکول) +
  `getAllCategories`/`getCategoriesByParent`/`getAllProvinces`/`getCitiesByProvince` کش‌شده.
- [x] **R3 — ماژول files (پورت imach-back):** درایور arvan/local + پاین‌لاین sharp
  (اصلی+تامبنیل) + staging/reaper + replace + `uploadImage`/`getFileUrl`/`deleteImage` +
  ادمین `listOrphans`/`deleteOrphans`/`getUsage` + readMultipart با parts().
- [x] **R4 — محصولات:** `createProduct` (ویزارد، denorm کش‌شده، Counter اتمیک، ظرفیت ۵) /
  `getProductList` (فیلتر درخت دسته + استان/شهر + جستجو، سورت مرتبط‌ترین=نردبان اول /
  جدیدترین، صفحه‌بندی، عکس‌ها از galleryMap) / `getProductById` (+بازدید) /
  `getRelatedProducts` / `getMyProducts` (+شمارنده تب) / `deleteMyProduct` (نرم) /
  `getSeller` / `searchSuggestions`.
- [x] **R5 — seed محصولات باسکول:** ۲۶ فروشنده + ۶۰ آگهی واقعی + rehost عکس‌ها در آروان
  (اصلی ۱۶۰۰ + تامبنیل ۴۰۰ + immutable) + Counter + fixer ObjectId.
- [x] **B6 — احراز هویت اسناد:** `submitVerification` (multipart اتمیک: کارت ملی + سلفی
  در یک درخواست، جبران کامل در خطا) / `getMyVerification` / ادمین:
  `getVerificationOrders` + `reviewVerification` (تأیید → isVerified + denorm
  sellerIsVerified همه آگهی‌ها + ابطال کش؛ رد → دلیل برای کاربر) + `make-admin.mjs`.
  تست سرتاسری ۱۸/۱۸ + تست مرورگر (هر ۴ حالت UI: none/pending/approved/rejected).
- [x] **B7 — درخواست‌های خرید (RFQ):** seed ۶۰ درخواست واقعی + ۵۳ خریدار باسکول
  (`seed-buy-requests.mjs` idempotent). `createBuyRequest` (ویزارد، «نوع کالا» → نود
  PRODUCT_TYPE با Counter ۹۰۰هزار، idempotent) / `getBuyRequestList` (جستجو contains
  + فیلتر استان + صفحه‌بندی) / `getLatestBuyRequests` / `getMyBuyRequests` (+شمارنده) /
  `deleteMyBuyRequest` / `getBuyRequestContact` (Lead-gen — لاگین لازم) /
  `getSuggestedBuyers` (سه سطح تطبیق exact/same-product/near-category + امتیاز حجم) /
  ادمین `reviewBuyRequest` + `reviewProduct` (تأیید/رد آگهی) / CRM نشان‌شده‌ها:
  SavedList/SavedUser/SavedUserNote با ۱۰ اندپوینت (لیست/نام/حذف/نشان/وضعیت ۷گانه/
  یادداشت/انتقال). تست سرتاسری ۴۴/۴۴ + تست مرورگر کامل.
- [x] **B8 — چت و پیام‌ها:** ChatThread/ChatMessage (یکتا به‌ازای خریدار×آگهی؛ denorm
  lastMessageAt). REST: `startThread` (idempotent) / `sendMessage` / `getThreadMessages`
  (باز کردن = خواندن + رویداد تیک) / `markThreadRead` / `getConversations` (unread گروهی)
  / `getThread`. WebSocket: fastify-socket.io روی همان پورت؛ handshake با JWT → اتاق
  `user:{id}`؛ رویدادهای `chat:newMessage` / `chat:read`؛ تنزل تدریجی به REST.
  ⚠️ درس Prisma+Mongo: فیلتر `field: null` فقط null صریح را می‌گیرد نه فیلد غایب —
  create باید readAt: null صریح بنویسد. تست ۲۵/۲۵ + مرورگر (push زنده بدون ریلود).
- [x] **L1 — لوکیشن درختی واحد (بازطراحی مالک):** حذف دو جدول Province/City → یک
  کالکشن `Location` با `type` (province/city/region/neighborhood…) + `parentId`
  خودارجاع. ⚠️ کشف مهم: id های عددی باسکولِ استان و شهر از دو فضای جدا هستند و
  برخورد دارند (شهر ۴=بستان‌آباد، استان ۴=اصفهان) → کلید یکتای درخت رشتهٔ ترکیبی
  «province:4»/«city:230» + `buskolId` عددی + `@@unique([type, buskolId])`.
  API ها همان id عددی خام باسکول را برمی‌گردانند (فرانت و آگهی‌های موجود بدون
  تغییر). اندپوینت عمومی جدید `getLocationsByParent` (کلید والد → فرزندان) برای
  سطح‌های آینده (منطقه/محله) بدون مهاجرت. seed+drop+reseed اجرا شد؛ تست
  test-locations ۱۰/۱۰ + کل سوئیت‌های R (۳۲) B6 (۱۸) B7 (۴۴) B8 (۲۵) پاس.
- [x] **B9 — کیف پول و نردبان:** شارژ کارت‌به‌کارت (۳ پکیج p100/p200/p400 با
  ۱۰٪/۲۰٪ شارژ اضافه؛ فیش → ChargeOrder + فایل receipt طبق دکترین imach-back
  با جبران کامل در خطا) → ادمین `getChargeOrders`/`reviewChargeOrder` (تأیید →
  شارژ اتمیک به موجودی؛ رد → دلیل). `getWallet` (موجودی + کارت واریز از env +
  پکیج‌ها) / `getWalletTransactions` (شارژ/رد/نردبان یکجا). نردبان:
  `ladderProduct` (۱۰۰هزار/ماه؛ فقط آگهی تأییدشدهٔ خودِ کاربر؛ کسر اتمیک با گارد
  شرطی داخل تراکنش — P2025 → WALLET_INSUFFICIENT؛ تمدید = امتداد انقضا؛
  denorm is_ladder + ladder_expires_at + ابطال کش) + reaper ساعتی انقضا به‌علاوه
  فیلتر زندهٔ لیست. پاک‌سازی نخاله‌های آزمایش قدیمی (سشن گم‌شده با طرح دیگری:
  کالکشن WalletTransaction جدا + سندهای بدون package_key) با
  `cleanup-b9-debris.mjs`. تست سرتاسری ۴۴/۴۴ + رگرسیون کامل R(32) B6(18)
  B7(44) B8(25) L(10) — سوئیت‌های B6/B8/R هم self-cleaning شدند.
- [ ] **B10 — وب‌پوش:** subscription با VAPID + نوتیف (پیام/قیمت/انقضا).
- [ ] **B11 — سخت‌سازی نهایی:** rate limit سراسری ریزتر، Redis (اختیاری)، لاگ pino، بکاپ.

## ۷. فازهای فرانت

- [x] **F1 — زیرساخت API واقعی + اتصال کامل:** کلاینت fetch مرکزی `src/lib/api/client.ts`
  (unwrapp {status,data} + توکن‌ها + رفرش تک‌پرواز + uploadImage) + rewrite `/api/**` →
  :4000/api/v1/** + auth واقعی OTP (تست مرورگر: devCode → JWT → getProfile → user_name) +
  سوییچ کامل `lib/mock/api.ts` (محصولات/دسته‌ها/مکان‌ها/فروشنده/پنل) + **next/image همه‌جا
  با تامبنیل ۴۰۰px در کارت‌ها** + SSR صفحه جزئیات (60s) و پروفایل (120s) + sitemap داینامیک
  (1h) + ویزارد با آپلود واقعی عکس بعد از ثبت. باقی (RFQ/CRM/کیف پول) ماک تا B6-B9.
- [ ] **F2 — تکمیل SSR/ISR:** لیست محصولات/درخواست‌ها با revalidate + JSON-LD کامل.
- [ ] **F4 — پنل به API زنده:** ورود OTP واقعی، ویزارد با آپلود واقعی (بعد از ثبت محصول)،
  محصولات من، نردبان و کیف پول.
- [ ] **F5 — پرفورمنس و کش نهایی:** ممیزی bundle، Lighthouse ≥ ۹۰، prefetch داخلی، CWV.

---

## ۸. چک‌لیست یادآور هر زیرفاز (قبل از commit چک شود)

**بک‌اند:**
- [ ] DTO + class-validator برای همه ورودی‌ها؟
- [ ] پاسخ یکنواخت `{status, data|message}`؟ پیام فارسی؟
- [ ] ایندکس مناسب برای کوئری‌های جدید؟ projection در لیست‌ها؟
- [ ] داده پایه → کش تگ‌دار؟ mutation → invalidateTag؟
- [ ] اندپوینت داده شخصی گارد شده؟
- [ ] فایل تغییر می‌کند؟ → replace/reaper/حذف قبلی (بخش ۵)
- [ ] درج مستقیم → ObjectId واقعی (نه رشته)؟
- [ ] تست curl انجام شد؟ لاگ خطا خواناست؟

**فرانت:**
- [ ] صفحه عمومی است یا پنل؟ (SSR/ISR در برابر کلاینت + noindex)
- [ ] متادیتا/canonical/OG/JSON-LD؟
- [ ] next/image به‌جای img خام؟ تامبنیل در کارت‌ها؟
- [ ] staleTime مناسب نوع داده؟ placeholderData صفحه‌بندی؟
- [ ] موبایل 390px بدون overflow؟
- [ ] URL خوانا و سئوپذیر؟

---

## ۹. متغیرهای محیطی (`.env`)

| کلید | کاربرد |
|---|---|
| `PORT` / `HOST` / `NODE_ENV` | سرویس (4000 / 0.0.0.0) |
| `DATABASE_URL` | رشته اتصال MongoDB Atlas |
| `JWT_SECRET` / `JWT_EXPIRES_IN` / `REFRESH_TOKEN_TTL_DAYS` | توکن‌ها |
| `OTP_FIXED_CODE` | کد ثابت OTP (1234) تا رسیدن پنل پیامک — با آمدن پنل خالی شود |
| `CORS_ORIGINS` / `SWAGGER_ENABLED` | CORS و مستندات |
| `PRISMA_ENGINES_MIRROR` | آینه دانلود موتورهای Prisma — رفع ECONNRESET در ایران |
| `STORAGE_DRIVER` | `arvan` (پیش‌فرض) | `local` |
| `MAX_FILE_SIZE` / `FILES_STAGING_TTL_DAYS` / `UPLOAD_PATH` / `PUBLIC_BASE_URL` | فایل‌ها |
| `ARVAN_ENDPOINT` / `ARVAN_REGION` / `ARVAN_ACCESS_KEY` / `ARVAN_SECRET_KEY` / `ARVAN_BUCKET_NAME` | Object Storage |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push |
| `WALLET_CARD_NUMBER` / `WALLET_CARD_OWNER` | کارت واریز کارت‌به‌کارت (B9) |

> `.env` طبق انتخاب مالک ریپو در گیت track می‌شود. اگر ریپو عمومی شد، حتماً خارج و چرخانده شود.

---

## ۱۰. اجرا و تست

```bash
# بک‌اند — روی ویندوز/لینوکس/مک (npm یا yarn؛ جزئیات کامل در README)
cd megan-back
npm install
npm run db:generate        # prisma generate (آینه ایران در .env)
npm run db:push             # ایندکس‌ها + اسکیما (node خالص، کراس‌پلتفرم)
npm run seed:base-data      # ۶۹۵ دسته + ۳۱ استان + ۴۷۴ شهر (درخت واحد)
npm run seed:products       # ۲۶ فروشنده + ۶۰ آگهی + rehost عکس‌ها (اختیاری — دیتای Atlas از قبل هست)
npm run dev                 # → http://localhost:4000/api/v1 (Swagger: /docs)

# تست دستی
curl http://localhost:4000/api/v1/health
curl -X POST http://localhost:4000/api/v1/auth/sendOtp -H 'Content-Type: application/json' -d '{"phone":"09123456789"}'
# → devCode در development برمی‌گردد
curl -X POST http://localhost:4000/api/v1/auth/verifyOtp -H 'Content-Type: application/json' -d '{"phone":"09123456789","code":"…"}'
curl -X POST http://localhost:4000/api/v1/products/getProductList -H 'Content-Type: application/json' -d '{"s":"پسته"}'
```

فرانت dev از اپ کاری روی پورت 3000 اجرا می‌شود؛ بعد از F1 درخواست‌های `/api/**` آن به همین سرویس پروکسی می‌شوند.

---

## ۱۱. تاریخچه فازها

| فاز | وضعیت | تاریخ |
|---|---|---|
| R0 زیرساخت Prisma | ✅ انجام شد | ۱۴۰۵/۰۸/۰۴ |
| R1 احراز هویت + کاربران | ✅ انجام شد | ۱۴۰۵/۰۸/۰۴ |
| R2 داده‌های پایه | ✅ انجام شد | ۱۴۰۵/۰۸/۰۴ |
| R3 ماژول files | ✅ انجام شد | ۱۴۰۵/۰۸/۰۴ |
| R4 محصولات | ✅ انجام شد | ۱۴۰۵/۰۸/۰۴ |
| R5 seed محصولات باسکول | ✅ انجام شد | ۱۴۰۵/۰۸/۰۴ |
| F1 اتصال فرانت به بک | ✅ انجام شد | ۱۴۰۵/۰۸/۰۴ |
| B6 احراز هویت اسناد | ✅ انجام شد | ۱۴۰۵/۰۸/۰۵ |
| B7 درخواست‌های خرید + CRM | ✅ انجام شد | ۱۴۰۵/۰۸/۰۵ |
| B8 چت و پیام‌ها | ✅ انجام شد | ۱۴۰۵/۰۸/۰۵ |
| L1 لوکیشن درختی واحد | ✅ انجام شد — بازطراحی مالک + رفع اجرای ویندوز/آینه پرایسما | ۱۴۰۵/۰۸/۰۵ |
| B9 کیف پول و نردبان | ✅ انجام شد — شارژ کارت‌به‌کارت + نردبان اتمیک + OTP ۴ رقمی ثابت 1234 | ۱۴۰۵/۰۸/۰۵ |
| B0–B3 (نسخه Mongoose) | 🗑 منسوخ — با R0–R5 جایگزین شد | — |
