# 🌱 Megan Backend — بازارگاه B2B عمده

NestJS 11 + **Fastify 5** + **Prisma 6** — هسته API بازارگاه «مِگان».

## وضعیت فعلی (فاز ۱)

طبق تصمیم فاز اول، تنها **مدل‌های داده** و اسکلت معماری پیاده شده‌اند:

- ✅ `prisma/schema.prisma` — کامل و **منطبق بر ساختار داده باسکول** (نام ستون‌ها/جدول‌ها یکسان برای مهاجرت مستقیم)
- ✅ Bootstrap با Fastify + ValidationPipe + prefix `/api/v1`
- ✅ `PrismaModule` سراسری
- ✅ ماژول `Categories` به‌عنوان **الگوی معماری**: کش TTL + قرارداد سازگار با `get_category_list` باسکول
- ✅ `CacheService` (حافظه محلی — برای production با Redis جایگزین می‌شود، اینترفیس ثابت می‌ماند)
- ✅ `CursorPagerDto` — صفحه‌بندی cursor-based (رفع ضعف باسکول: پاسخ ۲.۶MB بدون صفحه‌بندی!)

## مدل‌های داده (نگاشت به باسکول)

| مدل | جدول باسکول | نکته |
|---|---|---|
| `User` | `myusers` | `myuser_id`, `active_pakage_type`, `is_verified` |
| `Category` | `categories` | درخت ۳ سطحی خود-ارجاع + `unit`, `min`, `score` |
| `Province` / `City` | `provinces` / `cities` | کرمان=۲۱، اصفهان=۴ (شناسه‌های واقعی باسکول) |
| `Product` | `products` | `stock`, `min_sale_price`, `min_sale_amount`, `sub_category_id`, `is_elevated`, `has_video`, `is_old` |
| `BuyRequest` | `buy_ads` | `requirement_amount`, `category_id`, `myuser_id` |
| `Photo` / `Review` / `Favorite` / `PriceHistory` / `ChatThread` / `ChatMessage` / `OtpCode` | — | اعتماد، ترند قیمت (بهبود)، چت، ورود OTP |

> فیلدهای Prisma camelCase هستند ولی ستون‌های DB با `@map` دقیقاً snake_case مطابق باسکول —
> یعنی API تمیز + مهاجرت داده بدون تبدیل نام.

## اجرا

```bash
bun install        # یا npm install
cp .env.example .env
bunx prisma generate
bunx prisma db push        # با DATABASE_URL موجود در .env
bun run dev                # http://localhost:4000/api/v1/categories
```

## نقشه فازهای بعدی

1. **AuthModule** — OTP موبایل (مدل `OtpCode` آماده است) + JWT + guards
2. **ProductsModule** — CRUD + فیلتر چندوجهی + صفحه‌بندی cursor + ISR-friendly_ETags
3. **BuyRequestsModule** — RFQ + اعلان به فروشندگان مرتبط دسته
4. **ChatModule** — WebSocket (fastify-websocket)
5. **SearchModule** — suggest مثل `get-search-suggestion-keywords` با Postgres trigram
6. **PaymentsModule** — پرداخت امن (escrow)

## تصمیم‌های کلیدی

- **Fastify به‌جای Express**: throughput بالاتر، overhead کمتر — برای API عمومی B2B
- **Cursor pagination به‌جای offset**: پایدار روی داده درج‌شونده، ایندکس‌فرندلی
- **کش در دو لایه**: سرور (CacheService/Redis) + کلاینت (React Query در megan-web)
- **PostgreSQL**: در صورت MySQL بودن دامپ فعلی، فقط `provider` در schema را عوض کنید
