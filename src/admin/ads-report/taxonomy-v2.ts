/**
 * ─── تاکسونومی v2 — گروه‌بندی جدید ایمچ (۱۵ ریشه، درخت عمیق) ─────────────────
 *
 * تصمیم مالک (۱۶-۱۱): مهاجرت موازی با ایمپورت — سایت عمومی همچنان روی
 * دسته‌بندی پاسکال کار می‌کند؛ این درخت در صفحهٔ عمومی /product-filter
 * دیده می‌شود تا وقتی مالک تکمیل و سوییچ عمومی را اعلام کند.
 *
 * اصول (الگوی Alibaba/Made-in-China + بحث با مالک):
 *  • هر کالا فقط یک خانه دارد — بر اساس «چیستی کالا»، نه شغل فروشنده.
 *  • تفکیک فله/بسته‌بندی/صادراتی کار «فیلتر» است نه شاخهٔ دوم درخت.
 *  • مرزهای طلایی: زنده → دام؛ خوراکی مصرفی → غذایی؛ نهادهٔ تولید → نهاده‌ها.
 *  • خدمات B2B عمداً خارج از اسکوپ این فاز است (فازهای خیلی بعد).
 *  • عمق (خواستهٔ مالک ۱۶-۱۱ شب): تا سطح برگِ کالا (سیب، گلابی، تن ماهی…) —
 *    پوشش همهٔ ۶۲۳ برگ پاسکال + دسته‌های استاندارد B2B فراتر از پاسکال.
 *    تنوع زیر برگ (شیرودی/هاشمی برای برنج، آلباکور/زردبال برای تن ماهی…)
 *    «نوع کالا» است: اتریبیوت ctype روی برگ + جدول Good در دیتابیس.
 *
 * ساختار: کلیدهای سلسله‌مراتبی نقطه‌گذر («agri.pulses.chickpea») — زیردرخت
 * با پیشوند کلید قابل محاسبه است. نام‌های برگ عمداً با نام برگ‌های پاسکال
 * یکی نگه داشته شده‌اند تا مولد نگاشت (scripts/gen-taxonomy-map.ts) با
 * تطبیق خودکار نام، آن‌ها را روی عمق کامل بنشاند.
 *
 * attrs (نوع کالا و ویژگی‌های فیلترپذیر): برای برگ‌های پایلوت تعریف شده
 * (نخود، پفک، برنج، تن ماهی — الگوی پروتوتایپ «تامینان»). «match» آرایهٔ
 * نام‌های هم‌معنی است که با توکن‌های نام آگهی تطبیق داده می‌شود. سایر
 * برگ‌ها به‌تدریج و با تأیید مالک اتریبیوت می‌گیرند.
 */

export interface TaxonomyAttrOption {
  /** برچسب نمایش */
  label: string;
  /** نام‌های هم‌معنی برای تطبیق با نام آزاد آگهی (خالی = فقط دستی) */
  match: string[];
}

export interface TaxonomyAttr {
  key: string;
  label: string;
  hint?: string;
  options: TaxonomyAttrOption[];
}

export interface TaxonomyNode {
  key: string;
  name: string;
  /** آیکون lucide — فقط ریشه‌ها */
  icon?: string;
  /** تعریف ویژگی‌های فیلترپذیر (فقط گره‌های پایلوت) */
  attrs?: TaxonomyAttr[];
  /** مثال «نوع کالا» برای پلیس‌هولدر فرم‌های ثبت/درخواست — فقط برگ‌ها؛
   *  میراث example پاسکال (categories.json) برای برگ‌های نگاشت‌شده و
   *  مثال واقعی B2B برای برگ‌های فراتر از پاسکال (۲۷-۱۱) */
  example?: string;
  children?: TaxonomyNode[];
}

/** کلیدهای این تاکسونومی — کوچک‌ترین واحد نگاشت */
export const TAXONOMY_V2_ROOTS: TaxonomyNode[] = [
  {
    key: 'agri',
    name: 'کشاورزی و باغبانی',
    icon: 'sprout',
    children: [
      {
        key: 'agri.fruit',
        name: 'میوه',
        children: [
          { key: 'agri.fruit.apple', name: 'سیب', example: 'قرمز' },
          { key: 'agri.fruit.pear', name: 'گلابی', example: 'درگزی' },
          { key: 'agri.fruit.quince', name: 'به', example: 'درجه یک' },
          { key: 'agri.fruit.peach', name: 'هلو و شلیل', example: 'درجه یک' },
          { key: 'agri.fruit.apricot', name: 'زردآلو', example: 'درجه یک' },
          { key: 'agri.fruit.sour-cherry', name: 'آلبالو', example: 'مجاری' },
          { key: 'agri.fruit.cherry', name: 'گیلاس', example: 'تکدانه' },
          { key: 'agri.fruit.grape', name: 'انگور', example: 'سیاه' },
          { key: 'agri.fruit.pomegranate', name: 'انار', example: 'قرمز' },
          { key: 'agri.fruit.fig', name: 'انجیر', example: 'زرد' },
          { key: 'agri.fruit.strawberry', name: 'توت‌فرنگی', example: 'گلخانه' },
          { key: 'agri.fruit.orange', name: 'پرتقال', example: 'والنسیا' },
          { key: 'agri.fruit.tangerine', name: 'نارنگی', example: 'درجه یک' },
          { key: 'agri.fruit.sour-lemon', name: 'لیمو ترش', example: 'لیسبون' },
          { key: 'agri.fruit.sweet-lemon', name: 'لیمو شیرین', example: 'درجه یک' },
          { key: 'agri.fruit.grapefruit', name: 'گریپ فروت', example: 'درجه یک' },
          { key: 'agri.fruit.kiwi', name: 'کیوی', example: 'هایوارد' },
          { key: 'agri.fruit.banana', name: 'موز', example: 'سومالی' },
          { key: 'agri.fruit.mango', name: 'انبه', example: 'پاکستانی' },
          { key: 'agri.fruit.pineapple', name: 'آناناس', example: 'درجه یک' },
          { key: 'agri.fruit.olive', name: 'زیتون', example: 'طارم' },
          { key: 'agri.fruit.date', name: 'خرما', example: 'مضافتی' },
        ],
      },
      {
        key: 'agri.veg',
        name: 'صیفی و سبزی',
        children: [
          { key: 'agri.veg.tomato', name: 'گوجه', example: 'متین' },
          { key: 'agri.veg.onion', name: 'پیاز', example: 'قرمز' },
          { key: 'agri.veg.potato', name: 'سیب‌زمینی', example: 'آگریا' },
          { key: 'agri.veg.garlic', name: 'سیر', example: 'طارم' },
          { key: 'agri.veg.carrot', name: 'هویج', example: 'درجه یک' },
          { key: 'agri.veg.cucumber', name: 'خیار', example: 'ویژه' },
          { key: 'agri.veg.eggplant', name: 'بادمجان', example: 'درجه یک' },
          { key: 'agri.veg.pepper', name: 'فلفل', example: 'قلمی' },
          { key: 'agri.veg.bell-pepper', name: 'فلفل دلمه‌ای', example: 'رنگی' },
          { key: 'agri.veg.cabbage', name: 'کلم', example: 'برگ' },
          { key: 'agri.veg.lettuce', name: 'کاهو', example: 'آیسبرگ' },
          { key: 'agri.veg.mushroom', name: 'قارچ', example: 'دکمه ای' },
          { key: 'agri.veg.okra', name: 'بامیه', example: 'درجه یک' },
          { key: 'agri.veg.green-bean', name: 'لوبیا سبز', example: 'درجه یک' },
          { key: 'agri.veg.celery', name: 'کرفس', example: 'درجه یک' },
          { key: 'agri.veg.turnip', name: 'شلغم', example: 'درجه یک' },
          { key: 'agri.veg.squash', name: 'کدو', example: 'حلوایی' },
          { key: 'agri.veg.herbs', name: 'سبزی', example: 'ریحان' },
          { key: 'agri.veg.dill', name: 'شوید', example: 'درجه یک' },
          { key: 'agri.veg.watermelon', name: 'هندوانه', example: 'بیضی' },
          { key: 'agri.veg.melon', name: 'خربزه', example: 'مشهدی' },
          { key: 'agri.veg.cantaloupe', name: 'طالبی', example: 'درجه یک' },
        ],
      },
      {
        key: 'agri.grains',
        name: 'غلات',
        children: [
          {
            key: 'agri.grains.rice',
            name: 'برنج', example: 'طارم',
            attrs: [
              {
                key: 'ctype',
                label: 'نوع کالا',
                hint: 'رقم برنج — مثل: شیرودی، هاشمی، طارم…',
                options: [
                  { label: 'شیرودی', match: ['شیرودی'] },
                  { label: 'هاشمی', match: ['هاشمی'] },
                  { label: 'طارم', match: ['طارم', 'طارم هاشمی'] },
                  { label: 'فجر', match: ['فجر'] },
                  { label: 'صدری', match: ['صدری'] },
                  { label: 'عنبربو', match: ['عنبربو', 'عنبر بو'] },
                  { label: 'دم‌سیاه', match: ['دم سیاه', 'دمسیاه'] },
                  { label: 'گرده', match: ['گرده'] },
                  { label: 'کوهسار', match: ['کوهسار'] },
                ],
              },
              {
                key: 'proc',
                label: 'عمل‌آوری',
                options: [
                  { label: 'سفید (پوست‌کنده)', match: ['سفید', 'پوست کنده', 'پوستکنده'] },
                  { label: 'قهوه‌ای (سبوس‌دار)', match: ['قهوه ای', 'قهوه‌ای', 'سبوس دار', 'سبوس‌دار'] },
                ],
              },
              {
                key: 'harvest',
                label: 'سال برداشت',
                options: [
                  { label: 'امسال', match: ['امسال', 'تازه برداشت', 'نوبر'] },
                  { label: 'پارسال', match: ['پارسال', 'سال قبل'] },
                ],
              },
              {
                key: 'pack',
                label: 'بسته‌بندی بار',
                options: [
                  { label: 'فله', match: ['فله'] },
                  { label: 'کیسه', match: ['کیسه'] },
                  { label: 'بسته برنددار', match: ['بسته', 'پاکت', 'گرمی'] },
                ],
              },
              {
                key: 'origin',
                label: 'خاستگاه',
                options: [
                  { label: 'گیلان', match: ['گیلان'] },
                  { label: 'مازندران', match: ['مازندران'] },
                  { label: 'گلستان', match: ['گلستان'] },
                  { label: 'خوزستان', match: ['خوزستان'] },
                ],
              },
            ],
          },
          { key: 'agri.grains.wheat', name: 'گندم', example: 'دیم' },
          { key: 'agri.grains.barley', name: 'جو', example: 'دوسر' },
          { key: 'agri.grains.corn', name: 'ذرت', example: 'شیرین' },
          { key: 'agri.grains.sesame', name: 'کنجد', example: 'قهوه ای' },
        ],
      },
      {
        key: 'agri.pulses',
        name: 'حبوبات',
        children: [
          { key: 'agri.pulses.beans', name: 'لوبیا', example: 'چیتی' },
          {
            key: 'agri.pulses.chickpea',
            name: 'نخود', example: 'دوخان',
            attrs: [
              {
                key: 'ctype',
                label: 'نوع کالا',
                hint: 'مثل: نخود کابل، ممبلی (سیاه)، لک، سه خان (کرمانشاه)',
                options: [
                  { label: 'کابل (سفید درشت)', match: ['کابل', 'سفید درشت', 'سه خان'] },
                  { label: 'ممبلی (سیاه)', match: ['ممبلی', 'مصدری'] },
                  { label: 'لک', match: ['لک'] },
                  { label: 'سفید ریز', match: ['سفید ریز', 'تک خان'] },
                  { label: 'دو خان', match: ['دو خان', 'دوخان'] },
                  { label: 'فلافلی (آردی)', match: ['فلافلی'] },
                  { label: 'آبگوشتی', match: ['آبگوشتی'] },
                ],
              },
              {
                key: 'proc',
                label: 'عمل‌آوری',
                options: [
                  { label: 'خام', match: ['خام'] },
                  { label: 'پوست‌کنده', match: ['پوست کنده', 'پوستکنده'] },
                  { label: 'بوداده', match: ['بوداده', 'برشته'] },
                ],
              },
              {
                key: 'grade',
                label: 'درجه کیفیت',
                options: [
                  { label: 'ممتاز (صادراتی)', match: ['ممتاز', 'صادراتی'] },
                  { label: 'درجه ۱', match: ['درجه 1', 'درجه یک', 'درجه۱', 'درجهیک'] },
                  { label: 'درجه ۲', match: ['درجه 2', 'درجه دو', 'درجه۲'] },
                  { label: 'خرد / زیر درجه', match: ['خرد', 'زیر درجه', 'شکسته'] },
                ],
              },
              {
                key: 'pack',
                label: 'بسته‌بندی بار',
                options: [
                  { label: 'فله', match: ['فله'] },
                  { label: 'کیسه ۲۵ کیلویی', match: ['کیسه 25', '25 کیلو', '۲۵ کیلو'] },
                  { label: 'کیسه ۵۰ کیلویی', match: ['کیسه 50', '50 کیلو', '۵۰ کیلو'] },
                  { label: 'بسته مصرفی', match: ['بسته مصرفی', 'گرمی', 'پاکت'] },
                ],
              },
              {
                key: 'harvest',
                label: 'سال محصول',
                options: [
                  { label: 'امسال', match: ['امسال', 'تازه برداشت', 'محصول نو'] },
                  { label: 'پارسال', match: ['پارسال', 'سال قبل'] },
                ],
              },
              {
                key: 'origin',
                label: 'خاستگاه',
                options: [
                  { label: 'کرمانشاه', match: ['کرمانشاه'] },
                  { label: 'خراسان', match: ['خراسان', 'مشهد'] },
                  { label: 'آذربایجان', match: ['آذربایجان', 'تبریز'] },
                  { label: 'اردکان (یزد)', match: ['اردکان', 'یزد'] },
                ],
              },
            ],
          },
          { key: 'agri.pulses.lentil', name: 'عدس', example: 'ساسکن' },
          { key: 'agri.pulses.soy', name: 'سویا', example: 'خوراکی' },
          { key: 'agri.pulses.split', name: 'لپه', example: 'آذرشهری' },
          { key: 'agri.pulses.faba', name: 'باقلا', example: 'خشک پوست‌دار' },
        ],
      },
      {
        key: 'agri.nuts',
        name: 'خشکبار',
        children: [
          { key: 'agri.nuts.pistachio', name: 'پسته', example: 'فندقی' },
          { key: 'agri.nuts.almond', name: 'بادام', example: 'منقا' },
          { key: 'agri.nuts.walnut', name: 'گردو', example: 'تویسرکان' },
          { key: 'agri.nuts.hazelnut', name: 'فندق', example: 'دوپوست' },
          { key: 'agri.nuts.raisin', name: 'کشمش', example: 'سبز' },
          { key: 'agri.nuts.barberry', name: 'زرشک', example: 'زیرتالاری' },
          { key: 'agri.nuts.sunflower', name: 'تخمه آفتابگردان', example: 'کانادایی' },
          { key: 'agri.nuts.dried-fruit', name: 'میوه خشک', example: 'قیسی' },
          { key: 'agri.nuts.dried-herbs', name: 'سبزی خشک', example: 'نعنا خشک' },
        ],
      },
      {
        key: 'agri.spices',
        name: 'ادویه و گیاهان دارویی',
        children: [
          { key: 'agri.spices.saffron', name: 'زعفران', example: 'سرگل' },
          { key: 'agri.spices.turmeric', name: 'زردچوبه', example: 'قلم' },
          { key: 'agri.spices.cinnamon', name: 'دارچین', example: 'قلم' },
          { key: 'agri.spices.black-pepper', name: 'فلفل سیاه', example: 'پودری' },
          { key: 'agri.spices.cardamom', name: 'هل', example: 'اکبر بنفش' },
          { key: 'agri.spices.ginger', name: 'زنجبیل', example: 'خشک' },
          { key: 'agri.spices.thyme', name: 'آویشن', example: 'شیرازی' },
          { key: 'agri.spices.garlic-powder', name: 'پودر سیر', example: 'درجه یک' },
          { key: 'agri.spices.chili-powder', name: 'پودر فلفل', example: 'فلفل سفید' },
          { key: 'agri.spices.medicinal', name: 'گیاهان دارویی', example: 'اسطوخودوس' },
        ],
      },
      {
        key: 'agri.flowers',
        name: 'گل و گیاه',
        children: [
          { key: 'agri.flowers.cut-flowers', name: 'گل شاخه‌بریده', example: 'رز هلندی' },
          { key: 'agri.flowers.houseplants', name: 'گیاهان آپارتمانی', example: 'سانسوریا' },
        ],
      },
    ],
  },
  {
    key: 'livestock',
    name: 'دام، طیور و آبزیان زنده',
    icon: 'beef',
    children: [
      {
        key: 'livestock.live',
        name: 'دام و طیور زنده',
        children: [
          { key: 'livestock.live.sheep-goat', name: 'گوسفند و بز', example: 'قشقایی' },
          { key: 'livestock.live.cattle', name: 'گاو و گوساله', example: 'هلشتاین' },
          { key: 'livestock.live.poultry', name: 'طیور زنده', example: 'جوجه یک روزه' },
          { key: 'livestock.live.bee', name: 'زنبور و کلنی', example: 'کلنی ۶ فریمی' },
        ],
      },
      {
        key: 'livestock.aquatic',
        name: 'آبزیان زنده و بچه‌ماهی',
        children: [
          { key: 'livestock.aquatic.fry', name: 'بچه‌ماهی و تکثیر', example: 'فارگالی قزل‌آلا' },
          { key: 'livestock.aquatic.live-food', name: 'آبزیان زندهٔ خوراکی', example: 'کپور' },
        ],
      },
    ],
  },
  {
    key: 'food',
    name: 'مواد غذایی و آشامیدنی',
    icon: 'utensils',
    children: [
      {
        key: 'food.beverages',
        name: 'نوشیدنی',
        children: [
          { key: 'food.beverages.tea', name: 'چای', example: 'سرگل' },
          { key: 'food.beverages.coffee', name: 'قهوه', example: 'عربیکا' },
          { key: 'food.beverages.juice', name: 'آبمیوه', example: 'نکتار' },
          { key: 'food.beverages.soda', name: 'نوشابه', example: 'خانواده' },
          { key: 'food.beverages.mineral-water', name: 'آب معدنی', example: 'کوچک' },
          { key: 'food.beverages.herbals', name: 'عرقیات', example: 'عرق کاسنی' },
        ],
      },
      {
        key: 'food.protein',
        name: 'مواد پروتئینی',
        children: [
          { key: 'food.protein.meat', name: 'گوشت', example: 'گوسفندی' },
          { key: 'food.protein.processed-meat', name: 'فرآورده گوشتی', example: 'سوسیس' },
          { key: 'food.protein.fish', name: 'ماهی', example: 'قزل آلا' },
          { key: 'food.protein.shrimp', name: 'میگو', example: 'پرورشی' },
          { key: 'food.protein.egg', name: 'تخم مرغ', example: 'دوزرده' },
          { key: 'food.protein.quail-egg', name: 'تخم بلدرچین', example: 'درجه یک' },
        ],
      },
      {
        key: 'food.dairy',
        name: 'لبنیات',
        children: [
          { key: 'food.dairy.milk', name: 'شیر', example: 'فرادما' },
          { key: 'food.dairy.cheese', name: 'پنیر', example: 'لیقوان' },
          { key: 'food.dairy.yogurt', name: 'ماست', example: 'چکیده' },
          { key: 'food.dairy.butter', name: 'کره', example: 'گیاهی' },
          { key: 'food.dairy.kashk', name: 'کشک', example: 'کشک گاوی' },
          { key: 'food.dairy.ice-cream', name: 'بستنی', example: 'سنتی' },
        ],
      },
      {
        key: 'food.snacks',
        name: 'تنقلات و شیرینی',
        children: [
          {
            key: 'food.snacks.puff',
            name: 'پفک', example: 'کرانچی',
            attrs: [
              {
                key: 'ctype',
                label: 'نوع بسته',
                hint: 'بسته‌ای برنددار، مینی، خانواده یا فله کیلویی',
                options: [
                  { label: 'پنیری', match: ['پنیری'] },
                  { label: 'مینی', match: ['مینی', '20 گرمی', '۲۰ گرمی'] },
                  { label: 'خانواده', match: ['خانواده', '200 گرمی', '۲۰۰ گرمی'] },
                  { label: 'فله', match: ['فله', 'کیلویی'] },
                ],
              },
              {
                key: 'flavor',
                label: 'طعم',
                options: [
                  { label: 'پنیر', match: ['پنیر'] },
                  { label: 'نمکی', match: ['نمکی'] },
                  { label: 'فلفلی', match: ['فلفلی', 'تند'] },
                  { label: 'سیر', match: ['سیر'] },
                  { label: 'کچاب', match: ['کچاب'] },
                ],
              },
              {
                key: 'brand',
                label: 'برند',
                hint: 'کالای فله همان «بدون برند» است',
                options: [
                  { label: 'چی‌توز', match: ['چی توز', 'چی‌توز', 'چیتوز'] },
                  { label: 'مینو', match: ['مینو'] },
                  { label: 'عالیس', match: ['عالیس'] },
                  { label: 'بهشاد', match: ['بهشاد'] },
                ],
              },
            ],
          },
          { key: 'food.snacks.chips', name: 'چیپس', example: 'فلفلی' },
          { key: 'food.snacks.biscuit', name: 'بیسکویت', example: 'موزی' },
          { key: 'food.snacks.chocolate', name: 'شکلات', example: 'شیری' },
          { key: 'food.snacks.cake', name: 'کیک و کلوچه', example: 'کشمشی' },
          { key: 'food.snacks.gum', name: 'آدامس', example: 'موزی' },
          { key: 'food.snacks.pastille', name: 'پاستیل', example: 'هاریبو' },
          { key: 'food.snacks.lavashak', name: 'لواشک', example: 'زردآلو' },
          { key: 'food.snacks.nabat', name: 'نبات', example: 'زعفرانی' },
        ],
      },
      {
        key: 'food.bakery',
        name: 'نان و ماکارونی',
        children: [
          { key: 'food.bakery.bread', name: 'نان', example: 'نان باگت' },
          { key: 'food.bakery.pasta', name: 'ماکارونی', example: 'فرمی' },
        ],
      },
      {
        key: 'food.ingredients',
        name: 'مواد اولیه و چاشنی',
        children: [
          { key: 'food.ingredients.oil', name: 'روغن خوراکی', example: 'آفتابگردان' },
          { key: 'food.ingredients.sugar', name: 'شکر', example: 'سفید' },
          { key: 'food.ingredients.cube-sugar', name: 'قند', example: 'حبه' },
          { key: 'food.ingredients.salt', name: 'نمک', example: 'خوراکی' },
          { key: 'food.ingredients.flour', name: 'آرد', example: 'گندم' },
          { key: 'food.ingredients.starch', name: 'نشاسته', example: 'ذرت' },
          { key: 'food.ingredients.vinegar', name: 'سرکه', example: 'قرمز' },
          { key: 'food.ingredients.lime-juice', name: 'آبلیمو', example: 'درجه یک' },
          { key: 'food.ingredients.ardé', name: 'ارده', example: 'قهوه ای' },
          { key: 'food.ingredients.milk-powder', name: 'شیر خشک', example: 'صنعتی' },
          { key: 'food.ingredients.confectionery', name: 'مواد اولیه قنادی', example: 'پودر خامه' },
        ],
      },
      {
        key: 'food.canned',
        name: 'کنسرو و غذای آماده',
        children: [
          {
            key: 'food.canned.tuna',
            name: 'تن ماهی', example: 'هوور',
            attrs: [
              {
                key: 'ctype',
                label: 'نوع کالا',
                hint: 'نوع ماهی تن — مثل: هوور، آلباکور، زردبال',
                options: [
                  { label: 'هوور', match: ['هوور'] },
                  { label: 'آلباکور', match: ['آلباکور', 'تن سفید'] },
                  { label: 'زردبال', match: ['زردبال', 'یلو فین', 'یلوفین'] },
                  { label: 'پارو (مخلوط)', match: ['پارو', 'مخلوط'] },
                ],
              },
              {
                key: 'brand',
                label: 'برند',
                hint: 'برندهای پرتکرار بازار',
                options: [
                  { label: 'محفل', match: ['محفل'] },
                  { label: 'مافتون', match: ['مافتون'] },
                  { label: 'تندرست', match: ['تندرست'] },
                  { label: 'باربارا', match: ['باربارا'] },
                ],
              },
              {
                key: 'prep',
                label: 'ماهیت',
                options: [
                  { label: 'روغن و نمک', match: ['روغن', 'روغن نمک'] },
                  { label: 'آب‌پز', match: ['آب پز', 'آبپز', 'در آب'] },
                  { label: 'سس گوجه', match: ['سس گوجه', 'سس'] },
                ],
              },
              {
                key: 'can',
                label: 'وزن قوطی',
                options: [
                  { label: '۲۰۰ گرمی', match: ['200', '200گرمی', '200 گرمی', '200گرم', '200 گرم'] },
                  { label: '۱۸۰ گرمی', match: ['180', '180گرمی', '180 گرمی', '180گرم', '180 گرم'] },
                  { label: '۱۲۰ گرمی', match: ['120', '120گرمی', '120 گرمی', '120گرم', '120 گرم'] },
                  { label: '۸۰ گرمی', match: ['80', '80گرمی', '80 گرمی', '80گرم', '80 گرم'] },
                ],
              },
              {
                key: 'pack',
                label: 'بسته‌بندی فروش',
                options: [
                  { label: 'کارتن ۲۴ عددی', match: ['کارتن 24', '24 عددی'] },
                  { label: 'کارتن ۴۸ عددی', match: ['کارتن 48', '48 عددی'] },
                  { label: 'کارتن ۵۰ عددی', match: ['کارتن 50', '50 عددی'] },
                  { label: 'شیرینگ', match: ['شیرینگ', 'بسته'] },
                ],
              },
            ],
          },
          { key: 'food.canned.tomato-paste', name: 'رب گوجه‌فرنگی', example: 'اسپتیک' },
          { key: 'food.canned.pickles', name: 'ترشی', example: 'مخلوط' },
          { key: 'food.canned.pickled-cucumber', name: 'خیارشور', example: 'ویژه' },
          { key: 'food.canned.jam', name: 'مربا', example: 'هویج' },
          { key: 'food.canned.concentrate', name: 'کنسانتره میوه', example: 'کنسانتره سیب' },
          { key: 'food.canned.ready-meal', name: 'غذای نیمه‌آماده', example: 'پیاز سرخ شده' },
        ],
      },
      { key: 'food.honey', name: 'عسل و فرآورده‌های زنبور', example: 'چهل گیاه' },
    ],
  },
  {
    key: 'inputs',
    name: 'نهاده‌های کشاورزی و دامی',
    icon: 'shovel',
    children: [
      {
        key: 'inputs.fertilizer',
        name: 'کود',
        children: [
          { key: 'inputs.fertilizer.urea', name: 'کود اوره', example: '۴۶ درصد' },
          { key: 'inputs.fertilizer.phosphate', name: 'کود فسفاته', example: 'سوپر فسفات تریبل' },
          { key: 'inputs.fertilizer.potash', name: 'کود پتاسه', example: 'سولوپتاس' },
          { key: 'inputs.fertilizer.npk', name: 'کود کامل (NPK)', example: '۲۰-۲۰-۲۰' },
          { key: 'inputs.fertilizer.organic', name: 'کود آلی و دامی', example: 'کود مرغی' },
          { key: 'inputs.fertilizer.liquid', name: 'کود مایع', example: 'آهن کیلاته' },
        ],
      },
      {
        key: 'inputs.pesticide',
        name: 'سم و آفت‌کش',
        children: [
          { key: 'inputs.pesticide.insecticide', name: 'سم', example: 'سوسک' },
          { key: 'inputs.pesticide.pesticide', name: 'آفت‌کش', example: 'شته کش' },
          { key: 'inputs.pesticide.fungicide', name: 'قارچ‌کش', example: 'بنومیل' },
          { key: 'inputs.pesticide.herbicide', name: 'علف‌کش', example: 'ترفلان' },
          { key: 'inputs.pesticide.hormone', name: 'هورمون و محرک رشد', example: 'ریشه زا' },
        ],
      },
      {
        key: 'inputs.seed',
        name: 'بذر و نهال',
        children: [
          { key: 'inputs.seed.seed', name: 'بذر', example: 'بذر گوجه' },
          { key: 'inputs.seed.seedling', name: 'نهال', example: 'گردو پیوندی' },
        ],
      },
      {
        key: 'inputs.feed',
        name: 'خوراک و علوفهٔ دام',
        children: [
          { key: 'inputs.feed.livestock', name: 'خوراک دام', example: 'کنجاله سویا' },
          { key: 'inputs.feed.alfalfa', name: 'یونجه', example: 'خشک' },
          { key: 'inputs.feed.straw', name: 'کاه', example: 'نرم' },
          { key: 'inputs.feed.bran', name: 'کنجاله و سبوس', example: 'کنجاله سویا' },
        ],
      },
      {
        key: 'inputs.supplies',
        name: 'پلاستیک و ملزومات کشاورزی',
        children: [
          { key: 'inputs.supplies.agri-plastic', name: 'پلاستیک کشاورزی', example: 'گلخانه' },
          { key: 'inputs.supplies.seedling-tray', name: 'سینی نشا', example: 'سینی ۶۰ خانه' },
          { key: 'inputs.supplies.shade-net', name: 'تور و سایه‌بان', example: 'تور ۷۰ درصد' },
        ],
      },
      {
        key: 'inputs.pet-food',
        name: 'خوراک حیوانات خانگی',
        children: [
          { key: 'inputs.pet-food.cat', name: 'خوراک گربه', example: 'ویت (مرطوب)' },
          { key: 'inputs.pet-food.dog', name: 'خوراک سگ', example: 'استارتر (بچه‌سگ)' },
          { key: 'inputs.pet-food.bird-fish', name: 'خوراک پرنده و آبزی', example: 'پلت قزل‌آلا' },
        ],
      },
    ],
  },
  {
    key: 'machinery',
    name: 'ماشین‌آلات و تجهیزات صنعتی',
    icon: 'cog',
    children: [
      {
        key: 'machinery.agri',
        name: 'ماشین‌آلات کشاورزی',
        children: [
          { key: 'machinery.agri.tractor', name: 'تراکتور', example: 'باغی' },
          { key: 'machinery.agri.tiller', name: 'تیلر', example: 'باغی' },
          { key: 'machinery.agri.sprayer', name: 'سمپاش', example: 'شارژی' },
          { key: 'machinery.agri.harvester', name: 'دروگر', example: 'دوچرخ' },
          { key: 'machinery.agri.seeder', name: 'بذرکار', example: 'دستی' },
          { key: 'machinery.agri.rotavator', name: 'روتیواتور', example: 'سنگین' },
          { key: 'machinery.agri.cultivator', name: 'کولتیواتور', example: 'کولتیواتور' },
          { key: 'machinery.agri.trailer', name: 'تریلر کشاورزی', example: 'دوچرخ' },
          { key: 'machinery.agri.implements', name: 'ادوات کشاورزی', example: 'چاله کن' },
          { key: 'machinery.agri.irrigation', name: 'تجهیزات آبیاری', example: 'مه پاش' },
          { key: 'machinery.agri.greenhouse', name: 'تجهیزات گلخانه', example: 'آبپاش' },
          { key: 'machinery.agri.livestock-tools', name: 'لوازم دامداری', example: 'پشم چین' },
          { key: 'machinery.agri.gardening', name: 'ابزار باغبانی', example: 'قیچی باغبانی' },
          { key: 'machinery.agri.incubator', name: 'دستگاه جوجه‌کشی', example: 'اتوماتیک' },
          { key: 'machinery.agri.feed-mill', name: 'دستگاه خوراک دام', example: 'پرس پلت' },
          { key: 'machinery.agri.milker', name: 'دستگاه شیردوش دام', example: 'شیردوش گاو' },
          { key: 'machinery.agri.grader', name: 'دستگاه بوجاری', example: 'حبوبات' },
        ],
      },
      {
        key: 'machinery.food',
        name: 'تجهیزات صنایع غذایی',
        children: [
          { key: 'machinery.food.cooking', name: 'تجهیزات پخت', example: 'تنور نان' },
          { key: 'machinery.food.oven', name: 'فر صنعتی', example: 'فر قنادی' },
          { key: 'machinery.food.mixer', name: 'همزن صنعتی', example: 'همزن قنادی' },
          { key: 'machinery.food.fryer', name: 'دستگاه سرخ‌کن صنعتی', example: 'سرخ کن صنعتی' },
          { key: 'machinery.food.dairy', name: 'تجهیزات فرآوری لبنیات', example: 'بیدون' },
          { key: 'machinery.food.meat', name: 'تجهیزات فرآوری گوشت', example: 'استخوان شکن' },
          { key: 'machinery.food.fruit-veg', name: 'تجهیزات فرآوری میوه و سبزی', example: 'دستگاه سورت' },
          { key: 'machinery.food.grain', name: 'تجهیزات فرآوری غلات', example: 'الواتور' },
          { key: 'machinery.food.nuts', name: 'دستگاه فرآوری خشکبار', example: 'تفت آجیل' },
          { key: 'machinery.food.honey', name: 'دستگاه فرآوری عسل', example: 'ساشه عسل' },
        ],
      },
      {
        key: 'machinery.packaging',
        name: 'ماشین‌آلات بسته‌بندی و پرکن',
        children: [
          { key: 'machinery.packaging.filler', name: 'دستگاه پرکن', example: 'چند نازل' },
          { key: 'machinery.packaging.shrink', name: 'دستگاه شرینک', example: 'تونلی' },
          { key: 'machinery.packaging.vacuum', name: 'دستگاه وکیوم بسته‌بندی', example: 'خانگی' },
          { key: 'machinery.packaging.sealer', name: 'دستگاه دوخت پلاستیک', example: 'ریلی' },
          { key: 'machinery.packaging.labeler', name: 'دستگاه لیبل‌زن', example: 'صنعتی' },
          { key: 'machinery.packaging.inkjet', name: 'جت پرینتر', example: 'دستی' },
          { key: 'machinery.packaging.laminator', name: 'دستگاه لمینیت', example: 'لمینت' },
          { key: 'machinery.packaging.line', name: 'خط بسته‌بندی', example: 'حبوبات' },
          { key: 'machinery.packaging.parts', name: 'قطعات تجهیزات بسته‌بندی', example: 'تسمه کش' },
        ],
      },
      {
        key: 'machinery.printing',
        name: 'ماشین‌آلات چاپ',
        children: [
          { key: 'machinery.printing.press', name: 'دستگاه چاپ', example: 'چاپ بنر' },
          { key: 'machinery.printing.digital', name: 'پرینتر دیجیتالی', example: 'چندکاره' },
          { key: 'machinery.printing.offset', name: 'پرینتر افست', example: 'تک رنگ' },
          { key: 'machinery.printing.3d', name: 'پرینتر سه‌بعدی', example: 'صنعتی' },
          { key: 'machinery.printing.heat-press', name: 'دستگاه پرس حرارتی', example: 'دستی کشویی' },
          { key: 'machinery.printing.parts', name: 'قطعات دستگاه چاپ', example: 'کارتریج' },
        ],
      },
      {
        key: 'machinery.sewing',
        name: 'ماشین‌آلات دوخت و نساجی',
        children: [
          { key: 'machinery.sewing.machine', name: 'چرخ خیاطی', example: 'صنعتی' },
          { key: 'machinery.sewing.flatseam', name: 'چرخ سردوز', example: 'صنعتی' },
          { key: 'machinery.sewing.knitting', name: 'دستگاه بافندگی', example: 'صنعتی' },
          { key: 'machinery.sewing.weaving', name: 'دستگاه بافت', example: 'صنعتی' },
          { key: 'machinery.sewing.cutter', name: 'دستگاه برش پارچه', example: 'اتوماتیک' },
          { key: 'machinery.sewing.shoemaking', name: 'دستگاه تولید کفش', example: 'صنعتی' },
        ],
      },
      {
        key: 'machinery.workshop',
        name: 'ماشین‌آلات کارگاهی',
        children: [
          { key: 'machinery.workshop.injection', name: 'دستگاه تزریق پلاستیک', example: 'رومیزی' },
          { key: 'machinery.workshop.nylon', name: 'دستگاه تولید نایلون', example: 'دسته دار' },
          { key: 'machinery.workshop.compressor', name: 'کمپرسور', example: 'کمپرسور باد' },
          { key: 'machinery.workshop.furnace', name: 'کوره', example: 'صنعتی' },
          { key: 'machinery.workshop.lathe', name: 'دستگاه تراش', example: 'تراش رومیزی' },
          { key: 'machinery.workshop.cutter', name: 'دستگاه برش', example: 'برش سنگ' },
          { key: 'machinery.workshop.mill', name: 'آسیاب پلاستیک', example: 'شریدر' },
          { key: 'machinery.workshop.laser', name: 'دستگاه لیزر', example: 'لیزر برش' },
          { key: 'machinery.workshop.scale', name: 'پاسکال', example: 'پاسکال کفی' },
          { key: 'machinery.workshop.press', name: 'دستگاه پرس', example: 'پرس هیدرولیک' },
          { key: 'machinery.workshop.cnc', name: 'دستگاه سی‌ان‌سی', example: 'فرز سی ان سی' },
          { key: 'machinery.workshop.drill', name: 'دستگاه حفاری', example: 'معدن' },
          { key: 'machinery.workshop.turning', name: 'دستگاه خراطی', example: 'اتوماتیک' },
          { key: 'machinery.workshop.plating', name: 'دستگاه آبکاری', example: 'فانتاکروم' },
          { key: 'machinery.workshop.guillotine', name: 'دستگاه گیوتین', example: 'گیوتین پارچه' },
          { key: 'machinery.workshop.pvc', name: 'دستگاه پی‌وی‌سی', example: 'دستی' },
          { key: 'machinery.workshop.rolling', name: 'دستگاه نورد', example: 'نورد ورق' },
          { key: 'machinery.workshop.carton', name: 'دستگاه کارتن‌سازی', example: 'صنعتی' },
        ],
      },
      {
        key: 'machinery.construction',
        name: 'ماشین‌آلات راه، ساختمان و معدن',
        children: [
          { key: 'machinery.construction.excavator', name: 'بیل مکانیکی', example: 'زنجیری' },
          { key: 'machinery.construction.loader', name: 'لودر', example: '5 تن' },
          { key: 'machinery.construction.dozer', name: 'بلدوزر', example: 'D8' },
          { key: 'machinery.construction.crane', name: 'جرثقیل', example: '10 تن' },
          { key: 'machinery.construction.mixer', name: 'میکسر بتن', example: '400 لیتری' },
          { key: 'machinery.construction.pump', name: 'پمپ بتن', example: 'زمینی' },
          { key: 'machinery.construction.block-machine', name: 'دستگاه بلوک‌زن', example: 'نیمه اتوماتیک' },
          { key: 'machinery.construction.mold', name: 'قالب بتن', example: 'قالب فلزی' },
          { key: 'machinery.construction.hoist', name: 'بالابر ساختمان', example: 'تک فاز' },
          { key: 'machinery.construction.jack', name: 'جک سقفی', example: '4 متری' },
          { key: 'machinery.construction.crusher', name: 'دستگاه سنگ‌شکن', example: 'فکی' },
          { key: 'machinery.construction.trowel', name: 'ماله برقی', example: 'شمشه ویبره' },
          { key: 'machinery.construction.rebar', name: 'دستگاه خاموت‌زن', example: 'خاموت زن دستی' },
        ],
      },
      {
        key: 'machinery.hvac',
        name: 'تهویه، سرمایش و گرمایش',
        children: [
          { key: 'machinery.hvac.heating', name: 'تجهیزات گرمایشی', example: 'پکیج صنعتی' },
          { key: 'machinery.hvac.cooling', name: 'تجهیزات سرمایشی', example: 'کولر صنعتی' },
          { key: 'machinery.hvac.ventilation', name: 'تجهیزات تهویه', example: 'فن کویل' },
          { key: 'machinery.hvac.fan', name: 'هواکش', example: 'فن تهویه' },
          { key: 'machinery.hvac.boiler', name: 'دیگ بخار', example: 'بویلر' },
          { key: 'machinery.hvac.cooling-tower', name: 'برج خنک‌کننده', example: 'جریان متقاطع' },
          { key: 'machinery.hvac.exchanger', name: 'تجهیزات تبدیل حرارت', example: 'رادیاتور' },
          { key: 'machinery.hvac.parts', name: 'قطعات سرمایشی و گرمایشی', example: 'گیربکس فن' },
        ],
      },
      {
        key: 'machinery.cleaning',
        name: 'تجهیزات پاکسازی و تصفیه',
        children: [
          { key: 'machinery.cleaning.water-treatment', name: 'دستگاه تصفیه آب', example: 'خانگی' },
          { key: 'machinery.cleaning.water-filter', name: 'فیلتر تصفیه آب', example: 'خانگی' },
          { key: 'machinery.cleaning.carwash', name: 'دستگاه کارواش', example: 'خانگی' },
          { key: 'machinery.cleaning.rug-wash', name: 'دستگاه قالیشویی', example: 'اتوماتیک' },
          { key: 'machinery.cleaning.vacuum', name: 'جاروبرقی صنعتی', example: 'سطلی' },
          { key: 'machinery.cleaning.air-purifier', name: 'دستگاه تصفیه هوا', example: 'صنعتی' },
          { key: 'machinery.cleaning.air-filter', name: 'فیلتر تصفیه هوا', example: 'صنعتی' },
          { key: 'machinery.cleaning.ozone', name: 'دستگاه ازن‌ساز', example: 'استخری' },
          { key: 'machinery.cleaning.oxygen', name: 'دستگاه تولید اکسیژن', example: 'صنعتی' },
          { key: 'machinery.cleaning.disinfection', name: 'دستگاه ضدعفونی‌کننده', example: 'پدالی' },
          { key: 'machinery.cleaning.desalination', name: 'آب‌شیرین‌کن صنعتی', example: 'اسمزی' },
        ],
      },
      {
        key: 'machinery.energy',
        name: 'تجهیزات انرژی',
        children: [
          { key: 'machinery.energy.generator', name: 'ژنراتور', example: 'سه فاز' },
          { key: 'machinery.energy.solar', name: 'پنل خورشیدی', example: '1000 وات' },
          { key: 'machinery.energy.inverter', name: 'اینورتر خورشیدی', example: 'هایبرید' },
          { key: 'machinery.energy.ups', name: 'برق اضطراری', example: 'صنعتی' },
          { key: 'machinery.energy.transformer', name: 'ترانس برق', example: 'سه فاز' },
        ],
      },
      {
        key: 'machinery.handling',
        name: 'انبارداری و جابه‌جایی',
        children: [
          { key: 'machinery.handling.forklift', name: 'لیفتراک', example: 'دیزلی ۳ تن' },
          { key: 'machinery.handling.stacker', name: 'استاکر و پالت‌تراک', example: 'برقی بالابر' },
          { key: 'machinery.handling.trolley', name: 'ترولی و جابه‌جایی', example: 'چرخ‌دستی فلزی' },
          { key: 'machinery.handling.racking', name: 'قفسه و رک انبار', example: 'رکینگ پالتی' },
        ],
      },
    ],
  },
  {
    key: 'tools',
    name: 'ابزار، تأسیسات و قطعات فنی',
    icon: 'wrench',
    children: [
      {
        key: 'tools.hand',
        name: 'ابزار دستی و برقی',
        children: [
          { key: 'tools.hand.hand', name: 'ابزار دستی', example: 'چکش' },
          { key: 'tools.hand.power', name: 'ابزار برقی', example: 'دریل' },
          { key: 'tools.hand.air', name: 'ابزار بادی', example: 'بکس بادی' },
          { key: 'tools.hand.hydraulic', name: 'ابزار هیدرولیک', example: 'جک هیدرولیک' },
          { key: 'tools.hand.drill', name: 'مته', example: 'دریل' },
          { key: 'tools.hand.sandpaper', name: 'سنباده', example: 'تسمه ای' },
          { key: 'tools.hand.toolbox', name: 'جعبه ابزار', example: 'فلزی' },
        ],
      },
      {
        key: 'tools.welding',
        name: 'ابزار جوش و برش',
        children: [{ key: 'tools.welding.weld', name: 'ابزار جوش', example: 'سیم جوش' }],
      },
      {
        key: 'tools.fittings',
        name: 'لوله، اتصالات و یراق',
        children: [
          { key: 'tools.fittings.pipe', name: 'لوله و اتصالات', example: 'لوله  گاز' },
          { key: 'tools.fittings.hardware', name: 'یراق‌آلات', example: 'دستگیره' },
        ],
      },
      {
        key: 'tools.pumps',
        name: 'پمپ و شیرآلات صنعتی',
        children: [
          { key: 'tools.pumps.pump', name: 'پمپ', example: 'پمپ آب' },
          { key: 'tools.pumps.valve', name: 'شیرآلات صنعتی', example: 'شیر سوپاپی' },
        ],
      },
      {
        key: 'tools.electrical',
        name: 'برق و تأسیسات برقی',
        children: [
          { key: 'tools.electrical.cable', name: 'کابل', example: 'مفتولی' },
          { key: 'tools.electrical.wire', name: 'سیم', example: 'افشان' },
          { key: 'tools.electrical.battery', name: 'باتری', example: 'آلکالاین' },
          { key: 'tools.electrical.contactor', name: 'کنتاکتور', example: 'تک فاز' },
          { key: 'tools.electrical.fuse', name: 'فیوز', example: 'سه فاز' },
          { key: 'tools.electrical.switch', name: 'کلید و پریز', example: 'ممتاز' },
          { key: 'tools.electrical.adapter', name: 'آداپتور', example: '12 ولت' },
        ],
      },
      {
        key: 'tools.automation',
        name: 'اتوماسیون و الکترونیک صنعتی',
        children: [
          { key: 'tools.automation.plc', name: 'پی‌ال‌سی و کنترلر', example: 'ماژولار' },
          { key: 'tools.automation.drive', name: 'اینورتر و درایو', example: 'وکتوری' },
          { key: 'tools.automation.sensor', name: 'سنسور و ترانسمیتر', example: 'القایی' },
        ],
      },
      {
        key: 'tools.safety',
        name: 'ایمنی و حفاظت کار',
        children: [
          { key: 'tools.safety.clothing', name: 'لباس و کفش ایمنی', example: 'بوت سافتی' },
          { key: 'tools.safety.glove', name: 'دستکش ایمنی', example: 'چرمی جوشکاری' },
          { key: 'tools.safety.helmet', name: 'کلاه ایمنی', example: 'ABS' },
          { key: 'tools.safety.glasses', name: 'عینک ایمنی', example: 'عینک جوشکاری' },
          { key: 'tools.safety.mask', name: 'ماسک و حفاظت تنفسی', example: 'N95' },
          { key: 'tools.safety.fall', name: 'حفاظت از سقوط', example: 'کمربند ایمنی' },
          { key: 'tools.safety.fire', name: 'کپسول و آتش‌نشانی', example: 'پودری' },
        ],
      },
      {
        key: 'tools.lab',
        name: 'آزمایشگاهی و اندازه‌گیری',
        children: [
          { key: 'tools.lab.glassware', name: 'شیشه آزمایشگاهی', example: 'بشر' },
          { key: 'tools.lab.measure', name: 'تجهیزات اندازه‌گیری دقیق', example: 'کولیس' },
        ],
      },
      {
        key: 'tools.surveillance',
        name: 'تجهیزات نظارتی',
        children: [
          { key: 'tools.surveillance.camera', name: 'دوربین مداربسته', example: 'دوربین دام' },
          { key: 'tools.surveillance.recorder', name: 'تجهیزات ضبط و شبکه', example: 'DVR' },
        ],
      },
    ],
  },
  {
    key: 'packaging',
    name: 'کاغذ، چاپ و بسته‌بندی',
    icon: 'package',
    children: [
      {
        key: 'packaging.materials',
        name: 'کارتن، جعبه و ظروف بسته‌بندی',
        children: [
          { key: 'packaging.materials.carton', name: 'کارتن', example: 'کارتن تخم مرغ' },
          { key: 'packaging.materials.box', name: 'جعبه', example: 'میوه' },
          { key: 'packaging.materials.paper', name: 'کاغذ', example: 'A4' },
          { key: 'packaging.materials.bottle', name: 'بطری', example: 'پت' },
          { key: 'packaging.materials.barrel', name: 'بشکه', example: 'فلزی' },
          { key: 'packaging.materials.jumbo', name: 'جامبو بگ', example: 'جامبو بگ' },
          { key: 'packaging.materials.pallet', name: 'پالت', example: 'یورویی' },
          { key: 'packaging.materials.basket', name: 'سبد', example: 'پلاستیکی' },
          { key: 'packaging.materials.plastic', name: 'بسته‌بندی پلاستیکی', example: 'فیلم پلی استر' },
          { key: 'packaging.materials.metal', name: 'بسته‌بندی فلزی', example: 'قوطی فلزی' },
        ],
      },
      {
        key: 'packaging.film',
        name: 'سلفون، نایلون و فیلم',
        children: [
          { key: 'packaging.film.nyloon', name: 'نایلون', example: 'شیرینگ' },
          { key: 'packaging.film.cellophane', name: 'سلفون', example: 'استرچ' },
          { key: 'packaging.film.roll', name: 'رول پلاستیک', example: 'پالت بند' },
          { key: 'packaging.film.foil', name: 'فویل آلومینیومی', example: 'فویل غذا' },
        ],
      },
      {
        key: 'packaging.print',
        name: 'خدمات چاپ و لیبل',
        children: [
          { key: 'packaging.print.print', name: 'خدمات چاپ', example: 'افست' },
          { key: 'packaging.print.label', name: 'لیبل و استیکر', example: 'لیبل PVC' },
        ],
      },
      {
        key: 'packaging.stationery',
        name: 'نوشت‌افزار و ملزومات اداری',
        children: [
          { key: 'packaging.stationery.notebook', name: 'دفتر', example: 'سیمی' },
          { key: 'packaging.stationery.pencil', name: 'مداد', example: 'رنگی' },
          { key: 'packaging.stationery.pen', name: 'خودکار', example: 'آبی' },
          { key: 'packaging.stationery.marker', name: 'ماژیک', example: 'وایت برد' },
          { key: 'packaging.stationery.binder', name: 'زونکن', example: 'ممتاز' },
          { key: 'packaging.stationery.set', name: 'ست اداری', example: 'ممتاز' },
          { key: 'packaging.stationery.whiteboard', name: 'وایت‌برد', example: 'بزرگ' },
          { key: 'packaging.stationery.calculator', name: 'ماشین حساب', example: 'مهندسی' },
        ],
      },
    ],
  },
  {
    key: 'construction',
    name: 'مصالح و تجهیزات ساختمان',
    icon: 'brick-wall',
    children: [
      {
        key: 'construction.materials',
        name: 'مصالح پایه',
        children: [
          { key: 'construction.materials.cement', name: 'سیمان', example: 'پرتلند' },
          { key: 'construction.materials.gypsum', name: 'گچ', example: 'سفیدکاری' },
          { key: 'construction.materials.brick', name: 'آجر', example: 'آجرنما' },
          { key: 'construction.materials.block', name: 'بلوک', example: 'هبلکس' },
          { key: 'construction.materials.sand', name: 'شن و ماسه', example: 'نخودی' },
          { key: 'construction.materials.joist-block', name: 'تیرچه بلوک', example: 'کرومیت' },
          { key: 'construction.materials.foam', name: 'فوم ساختمانی', example: 'دانسیته 10' },
          { key: 'construction.materials.precast', name: 'دیوار پیش‌ساخته', example: 'بتنی' },
          { key: 'construction.materials.drywall', name: 'کناف', example: 'پانل' },
        ],
      },
      {
        key: 'construction.stone',
        name: 'سنگ، کاشی و سرامیک',
        children: [
          { key: 'construction.stone.stone', name: 'سنگ ساختمانی', example: 'تراورتن' },
          { key: 'construction.stone.tile', name: 'کاشی و سرامیک', example: 'راک' },
        ],
      },
      {
        key: 'construction.wood',
        name: 'چوب',
        children: [
          { key: 'construction.wood.timber', name: 'چوب خام و الوار', example: 'روسی' },
          { key: 'construction.wood.mdf', name: 'ام‌دی‌اف و نئوپان', example: 'ام‌دی‌اف ۸ میل' },
        ],
      },
      {
        key: 'construction.openings',
        name: 'درب و پنجره',
        children: [
          { key: 'construction.openings.door-window', name: 'درب و پنجره', example: 'درب پی وی سی' },
          { key: 'construction.openings.railing', name: 'نرده و حفاظ', example: 'استیل' },
          { key: 'construction.openings.elevator', name: 'آسانسور', example: 'گیربکسی' },
        ],
      },
      {
        key: 'construction.insulation',
        name: 'عایق و نسوز',
        children: [
          { key: 'construction.insulation.insulation', name: 'عایق', example: 'ایزوگام' },
          { key: 'construction.insulation.rockwool', name: 'پشم سنگ', example: 'تخته ای' },
          { key: 'construction.insulation.glasswool', name: 'پشم شیشه', example: 'بلنکت' },
          { key: 'construction.insulation.refractory', name: 'ورق نسوز', example: 'بلنکت' },
        ],
      },
      {
        key: 'construction.mep',
        name: 'تأسیسات و روشنایی ساختمان',
        children: [
          {
            key: 'construction.mep.lighting',
            name: 'تجهیزات روشنایی',
            children: [
              { key: 'construction.mep.lighting.lamp', name: 'لامپ', example: 'ال ای دی' },
              { key: 'construction.mep.lighting.light', name: 'چراغ', example: 'سقفی' },
              { key: 'construction.mep.lighting.chandelier', name: 'لوستر', example: 'کلاسیک' },
              { key: 'construction.mep.lighting.projector', name: 'پروژکتور', example: 'ال ای دی' },
              { key: 'construction.mep.lighting.abajur', name: 'آباژور', example: 'ایستاده' },
              { key: 'construction.mep.lighting.string', name: 'ریسه', example: 'توری' },
              { key: 'construction.mep.lighting.pole', name: 'پایه چراغ', example: 'باغی' },
            ],
          },
          {
            key: 'construction.mep.sanitary',
            name: 'شیرآلات و سانیتری',
            children: [
              { key: 'construction.mep.sanitary.faucet', name: 'شیرآلات', example: 'شیر روشویی' },
              { key: 'construction.mep.sanitary.washbasin', name: 'روشویی و دستشویی', example: 'روشویی کابینتی' },
              { key: 'construction.mep.sanitary.sink', name: 'سینک', example: 'تک لگن' },
              { key: 'construction.mep.sanitary.flush', name: 'سیفون', example: 'توکار' },
            ],
          },
          { key: 'construction.mep.plumbing', name: 'سایر تأسیسات ساختمان', example: 'رادیاتور' },
        ],
      },
      {
        key: 'construction.equipment',
        name: 'تجهیزات ساختمانی',
        children: [
          { key: 'construction.equipment.ladder', name: 'نردبان و داربست', example: '6 پله' },
          { key: 'construction.equipment.dripper', name: 'آبچکان', example: 'استیل' },
          { key: 'construction.equipment.fireplace', name: 'شومینه', example: 'کلاسیک' },
        ],
      },
    ],
  },
  {
    key: 'metals',
    name: 'فلزات، آهن‌آلات و ضایعات',
    icon: 'anvil',
    children: [
      {
        key: 'metals.steel',
        name: 'آهن و فولاد',
        children: [
          { key: 'metals.steel.rebar', name: 'میلگرد', example: 'آجدار' },
          { key: 'metals.steel.beam', name: 'تیرآهن', example: 'تیرآهن 16' },
          { key: 'metals.steel.sheet', name: 'ورق آهنی', example: 'ورق سیاه' },
          { key: 'metals.steel.galvanized', name: 'ورق گالوانیزه', example: 'گالوانیزه 2 میل' },
          { key: 'metals.steel.pipe', name: 'لوله آهنی', example: 'گوشتدار' },
          { key: 'metals.steel.box', name: 'قوطی آهن', example: 'قوطی 5' },
          { key: 'metals.steel.angle', name: 'نبشی', example: 'اسپیرال' },
          { key: 'metals.steel.channel', name: 'ناودانی', example: 'ناودانی 10' },
          { key: 'metals.steel.profile', name: 'پروفیل', example: 'پروفیل 3' },
          { key: 'metals.steel.mesh', name: 'توری آهنی', example: 'پرسی' },
          { key: 'metals.steel.fence', name: 'فنس', example: 'توری' },
          { key: 'metals.steel.barbed', name: 'سیم خاردار', example: 'سوزنی' },
          { key: 'metals.steel.ingot', name: 'شمش فولاد', example: 'سمانته' },
          { key: 'metals.steel.steel', name: 'فولاد', example: 'گرمکار' },
        ],
      },
      {
        key: 'metals.stainless',
        name: 'استیل',
        children: [
          { key: 'metals.stainless.sheet', name: 'ورق استیل', example: 'طرحدار' },
          { key: 'metals.stainless.pipe', name: 'لوله استیل', example: 'گوشتدار' },
          { key: 'metals.stainless.rebar', name: 'میلگرد استیل', example: 'استیل 304' },
          { key: 'metals.stainless.fittings', name: 'اتصالات استیل', example: 'زانویی' },
          { key: 'metals.stainless.profile', name: 'پروفیل استیل', example: 'استیل 304' },
        ],
      },
      {
        key: 'metals.aluminum',
        name: 'آلومینیوم',
        children: [
          { key: 'metals.aluminum.ingot', name: 'شمش آلومینیوم', example: 'ریخته گری' },
          { key: 'metals.aluminum.profile', name: 'پروفیل آلومینیوم', example: 'شیاردار' },
          { key: 'metals.aluminum.sheet', name: 'ورق آلومینیوم', example: 'رنگی' },
          { key: 'metals.aluminum.pipe', name: 'لوله آلومینیوم', example: 'درزدار' },
          { key: 'metals.aluminum.box', name: 'قوطی آلومینیومی', example: 'قوطی 3' },
          { key: 'metals.aluminum.angle', name: 'نبشی آلومینیومی', example: 'سپری' },
          { key: 'metals.aluminum.cable', name: 'کابل آلومینیومی', example: 'برق' },
          { key: 'metals.aluminum.powder', name: 'پودر آلومینیوم', example: 'اکسید' },
        ],
      },
      {
        key: 'metals.copper',
        name: 'مس، برنج و آلیاژها',
        children: [
          { key: 'metals.copper.copper', name: 'مس', example: 'ذوبی' },
          { key: 'metals.copper.brass', name: 'فلز برنج', example: 'چهارپهلو' },
          { key: 'metals.copper.lead', name: 'سرب', example: 'شمش' },
          { key: 'metals.copper.nickel', name: 'نیکل', example: 'شمش' },
        ],
      },
      {
        key: 'metals.ore',
        name: 'کانی و کنسانترهٔ فلزی',
        children: [
          { key: 'metals.ore.iron', name: 'سنگ آهن', example: 'هماتیت' },
          { key: 'metals.ore.pellet', name: 'گندله آهن', example: 'اسفنجی' },
          { key: 'metals.ore.copper', name: 'سنگ مس', example: 'سولفوره' },
          { key: 'metals.ore.lead', name: 'سنگ سرب', example: 'گالن' },
          { key: 'metals.ore.magnetite', name: 'سنگ مگنتیت', example: 'پودر' },
          { key: 'metals.ore.chrome', name: 'سنگ کروم', example: 'کرومیت' },
          { key: 'metals.ore.chromite', name: 'سنگ کرومیت', example: 'افیولیتی' },
          { key: 'metals.ore.manganese', name: 'سنگ منگنز', example: 'آهندار' },
        ],
      },
      {
        key: 'metals.scrap',
        name: 'ضایعات و بازیافت',
        children: [
          { key: 'metals.scrap.iron', name: 'ضایعات آهن', example: 'ورق' },
          { key: 'metals.scrap.steel', name: 'ضایعات فولاد', example: 'ورق' },
          { key: 'metals.scrap.copper', name: 'ضایعات مس', example: 'کابل' },
          { key: 'metals.scrap.brass', name: 'ضایعات برنج', example: 'سیم' },
          { key: 'metals.scrap.stainless', name: 'ضایعات استیل', example: 'ورق' },
          { key: 'metals.scrap.nickel', name: 'ضایعات نیکل', example: 'ورق' },
          { key: 'metals.scrap.plastic', name: 'ضایعات پلاستیک', example: 'پت' },
          { key: 'metals.scrap.pet', name: 'ضایعات پت', example: 'مخلوط' },
          { key: 'metals.scrap.paper', name: 'ضایعات کاغذ', example: 'پوشال' },
          { key: 'metals.scrap.carton', name: 'ضایعات کارتن', example: 'موزی' },
          { key: 'metals.scrap.glass', name: 'ضایعات شیشه', example: 'درهم' },
          { key: 'metals.scrap.rubber', name: 'ضایعات لاستیک', example: 'گرانول' },
          { key: 'metals.scrap.e-waste', name: 'ضایعات الکترونیکی', example: 'برد' },
          { key: 'metals.scrap.battery', name: 'ضایعات باطری', example: 'لیتیومی' },
          { key: 'metals.scrap.faucet', name: 'ضایعات شیرآلات', example: 'درهم' },
        ],
      },
    ],
  },
  {
    key: 'chemicals',
    name: 'شیمیایی، پلیمر و انرژی',
    icon: 'flask',
    children: [
      {
        key: 'chemicals.paint',
        name: 'رنگ، رزین و پوشش',
        children: [
          { key: 'chemicals.paint.industrial', name: 'رنگ صنعتی', example: 'مایع' },
          { key: 'chemicals.paint.oil', name: 'رنگ روغن', example: 'براق' },
          { key: 'chemicals.paint.acrylic', name: 'رنگ اکریلیک', example: 'درجه یک' },
          { key: 'chemicals.paint.plastic', name: 'رنگ پلاستیک', example: 'قابل شستشو' },
          { key: 'chemicals.paint.epoxy', name: 'رنگ اپوکسی', example: 'پلی آمیدی' },
          { key: 'chemicals.paint.polyurethane', name: 'رنگ پلی‌اورتان', example: 'الاستومری' },
          { key: 'chemicals.paint.polyester', name: 'رنگ پلی‌استر', example: 'نیم پلی استر' },
          { key: 'chemicals.paint.refractory', name: 'رنگ نسوز', example: 'کوره ای' },
          { key: 'chemicals.paint.wood', name: 'رنگ چوب', example: 'سیلر' },
          { key: 'chemicals.paint.powder', name: 'پودر رنگ', example: 'معدنی' },
          { key: 'chemicals.paint.spray', name: 'اسپری رنگ', example: 'مات' },
          { key: 'chemicals.paint.putty', name: 'بتونه', example: 'روغنی' },
          { key: 'chemicals.paint.resin', name: 'رزین', example: 'آلکیدی' },
          { key: 'chemicals.paint.epoxy-resin', name: 'رزین اپوکسی', example: 'شفاف' },
          { key: 'chemicals.paint.pu-resin', name: 'رزین پلی‌اورتان', example: 'نرم' },
          { key: 'chemicals.paint.thinner', name: 'تینر', example: 'فوری' },
          { key: 'chemicals.paint.solvent', name: 'حلال رنگ', example: 'الکلی' },
          { key: 'chemicals.paint.resin-solvent', name: 'حلال رزین', example: 'اکسیژنه' },
          { key: 'chemicals.paint.mold', name: 'قالب رزین', example: 'سیلیکون' },
          { key: 'chemicals.paint.fiberglass', name: 'فایبرگلاس', example: 'پلی استر' },
          { key: 'chemicals.paint.fiberglass-sheet', name: 'ورق فایبرگلاس', example: 'پلی استر' },
          { key: 'chemicals.paint.foam-spray', name: 'اسپری فوم', example: 'درجه یک' },
          { key: 'chemicals.paint.silicone-spray', name: 'اسپری سیلیکون', example: 'درجه یک' },
          { key: 'chemicals.paint.hardener', name: 'هاردنر', example: 'فنل آمین' },
        ],
      },
      {
        key: 'chemicals.industrial',
        name: 'مواد شیمیایی صنعتی',
        children: [
          { key: 'chemicals.industrial.sulfur', name: 'گوگرد', example: 'صنعتی' },
          { key: 'chemicals.industrial.urea', name: 'اوره', example: 'صنعتی' },
          { key: 'chemicals.industrial.caustic', name: 'سود پرک', example: 'صنعتی' },
          { key: 'chemicals.industrial.soda', name: 'سودا اش', example: 'صنعتی' },
          { key: 'chemicals.industrial.carbonate', name: 'کربنات سدیم', example: 'هیدراته' },
          { key: 'chemicals.industrial.bicarbonate', name: 'بیکربنات سدیم', example: 'صنعتی' },
          { key: 'chemicals.industrial.citric', name: 'اسید سیتریک', example: 'صنعتی' },
          { key: 'chemicals.industrial.sulfuric', name: 'اسید سولفوریک', example: 'صنعتی' },
          { key: 'chemicals.industrial.phosphoric', name: 'اسید فسفریک', example: 'صنعتی' },
          { key: 'chemicals.industrial.peroxide', name: 'آب اکسیژنه', example: 'صنعتی' },
          { key: 'chemicals.industrial.alcohol', name: 'الکل صنعتی', example: 'بی آب' },
          { key: 'chemicals.industrial.ethanol', name: 'اتانول صنعتی', example: 'بی آب' },
          { key: 'chemicals.industrial.acetone', name: 'استون', example: 'صنعتی' },
          { key: 'chemicals.industrial.propylene', name: 'پروپیلن گلیکول', example: 'صنعتی' },
          { key: 'chemicals.industrial.titanium', name: 'تیتانیوم دی‌اکسید', example: 'صنعتی' },
          { key: 'chemicals.industrial.polyelectrolyte', name: 'پلی‌الکترولیت', example: 'آنیونی' },
          { key: 'chemicals.industrial.permanganate', name: 'پرمنگنات پتاسیم', example: 'صنعتی' },
          { key: 'chemicals.industrial.ketrak', name: 'کتراک', example: 'صنعتی' },
          { key: 'chemicals.industrial.oxygen', name: 'گاز اکسیژن', example: 'صنعتی' },
          { key: 'chemicals.industrial.nitrogen', name: 'گاز نیتروژن', example: 'صنعتی' },
          { key: 'chemicals.industrial.acetylene', name: 'گاز استیلن', example: 'صنعتی' },
          { key: 'chemicals.industrial.chlorine', name: 'گاز کلر', example: 'صنعتی' },
          { key: 'chemicals.industrial.h2s', name: 'سولفید هیدروژن', example: 'صنعتی' },
          { key: 'chemicals.industrial.agar', name: 'آگار', example: 'صنعتی' },
        ],
      },
      {
        key: 'chemicals.minerals',
        name: 'کانی و مواد معدنی',
        children: [
          { key: 'chemicals.minerals.silica', name: 'سیلیس', example: 'پودر' },
          { key: 'chemicals.minerals.limestone', name: 'سنگ آهک', example: 'توفا' },
          { key: 'chemicals.minerals.barite', name: 'سنگ باریت', example: 'سوپرفاین' },
          { key: 'chemicals.minerals.quartz', name: 'کوارتز', example: 'عقیق' },
          { key: 'chemicals.minerals.graphite', name: 'سنگ گرافیت', example: 'کلوخه' },
          { key: 'chemicals.minerals.carbide', name: 'کاربید', example: 'کاربید کلسیم' },
        ],
      },
      {
        key: 'chemicals.polymers',
        name: 'پلاستیک و پلیمر',
        children: [
          { key: 'chemicals.polymers.pe', name: 'پلی‌اتیلن', example: 'سبک' },
          { key: 'chemicals.polymers.ps', name: 'پلی‌استایرن', example: 'انبساطی' },
          { key: 'chemicals.polymers.polymer', name: 'مواد پلیمری', example: 'گرانول' },
          { key: 'chemicals.polymers.raw-plastic', name: 'مواد اولیه پلاستیک', example: 'گرانول' },
          { key: 'chemicals.polymers.pu', name: 'مواد پلی‌یورتان', example: 'ایزوسیانات' },
          { key: 'chemicals.polymers.tissue', name: 'مواد اولیه دستمال کاغذی', example: 'تیشو' },
        ],
      },
      {
        key: 'chemicals.rubber',
        name: 'لاستیک صنعتی',
        children: [
          { key: 'chemicals.rubber.hose', name: 'شیلنگ', example: 'هوا' },
          { key: 'chemicals.rubber.sheet', name: 'ورق لاستیکی', example: 'ضد اسید' },
          { key: 'chemicals.rubber.bumper', name: 'ضربه‌گیر لاستیکی', example: 'ضربه گیر' },
          { key: 'chemicals.rubber.washer', name: 'واشر لاستیکی', example: 'لبه دار' },
        ],
      },
      {
        key: 'chemicals.glass',
        name: 'شیشه',
        children: [
          { key: 'chemicals.glass.building', name: 'شیشه ساختمانی', example: 'فلوت' },
          { key: 'chemicals.glass.secured', name: 'شیشه سکوریت', example: 'کریستال' },
          { key: 'chemicals.glass.double', name: 'شیشه دو جداره', example: 'رفلکس' },
          { key: 'chemicals.glass.laminated', name: 'شیشه لمینت', example: 'دولایه' },
          { key: 'chemicals.glass.colored', name: 'شیشه رنگی', example: 'لاکوبل' },
          { key: 'chemicals.glass.matted', name: 'شیشه مات', example: 'پارتیشنی' },
          { key: 'chemicals.glass.refractory', name: 'شیشه نسوز', example: 'صنعتی' },
          { key: 'chemicals.glass.polycarbonate', name: 'شیشه پلی‌کربنات', example: 'ورق' },
          { key: 'chemicals.glass.mirror', name: 'آینه', example: 'ساختمانی' },
          { key: 'chemicals.glass.fiber', name: 'الیاف شیشه', example: 'ورق' },
          { key: 'chemicals.glass.pipe', name: 'لوله شیشه‌ای', example: 'آزمایش' },
        ],
      },
      {
        key: 'chemicals.adhesives',
        name: 'چسب',
        children: [
          { key: 'chemicals.adhesives.tile', name: 'چسب کاشی', example: 'درجه یک' },
          { key: 'chemicals.adhesives.tape', name: 'چسب نواری', example: 'کارتن' },
          { key: 'chemicals.adhesives.123', name: 'چسب ۱۲۳', example: 'آکفیکس' },
          { key: 'chemicals.adhesives.sealing', name: 'چسب آب‌بندی', example: 'درجه یک' },
          { key: 'chemicals.adhesives.concrete', name: 'چسب بتن', example: 'درجه یک' },
          { key: 'chemicals.adhesives.stone', name: 'چسب سنگ', example: 'درجه یک' },
        ],
      },
      {
        key: 'chemicals.fuel',
        name: 'سوخت و انرژی',
        children: [
          { key: 'chemicals.fuel.coal', name: 'زغال', example: 'فشرده' },
          { key: 'chemicals.fuel.petrochemical', name: 'محصولات پتروشیمی', example: 'آمونیاک' },
          { key: 'chemicals.fuel.bitumen', name: 'قیر', example: 'مخلوط' },
          { key: 'chemicals.fuel.diesel', name: 'گازوئیل', example: 'استاندارد' },
          { key: 'chemicals.fuel.oil', name: 'روغن صنعتی', example: 'هیدرولیک' },
          { key: 'chemicals.fuel.paraffin', name: 'پارافین', example: 'مایع' },
          { key: 'chemicals.fuel.grease', name: 'گریس', example: 'بنتون' },
        ],
      },
    ],
  },
  {
    key: 'automotive',
    name: 'خودرو و حمل‌ونقل',
    icon: 'truck',
    children: [
      {
        key: 'automotive.vehicles',
        name: 'خودروهای تجاری و سنگین',
        children: [
          { key: 'automotive.vehicles.truck', name: 'کامیون و کشنده', example: 'شش‌چرخ' },
          { key: 'automotive.vehicles.pickup', name: 'وانت و نیسان', example: 'دابل‌کابین' },
          { key: 'automotive.vehicles.bus', name: 'اتوبوس و مینی‌بوس', example: 'VIP' },
          { key: 'automotive.vehicles.trailer', name: 'تریلر', example: 'تختی' },
        ],
      },
      {
        key: 'automotive.parts',
        name: 'قطعات و لوازم جانبی',
        children: [
          { key: 'automotive.parts.spare', name: 'لوازم یدکی', example: 'صفحه کلاچ' },
          { key: 'automotive.parts.engine', name: 'قطعات موتوری و گیربکس', example: 'تسمه تایم' },
          { key: 'automotive.parts.suspension', name: 'جلوبندی و تعلیق', example: 'کمک فنر' },
          { key: 'automotive.parts.av', name: 'سیستم صوتی و روشنایی', example: 'باند بیضی' },
          { key: 'automotive.parts.consumable', name: 'لوازم مصرفی', example: 'فلیتر هوا' },
          { key: 'automotive.parts.decor', name: 'لوازم تزئینی', example: 'کفپوش خودرو' },
        ],
      },
      {
        key: 'automotive.tires',
        name: 'لاستیک خودرو',
        children: [
          { key: 'automotive.tires.car', name: 'لاستیک سواری', example: 'رادیال' },
          { key: 'automotive.tires.truck', name: 'لاستیک کامیون', example: 'گل دنده' },
          { key: 'automotive.tires.bike', name: 'لاستیک دوچرخه', example: 'تیوبلس' },
          { key: 'automotive.tires.moto', name: 'لاستیک موتور سیکلت', example: 'تیوبلس' },
          { key: 'automotive.tires.loader', name: 'لاستیک لودر', example: 'تیوبلس' },
          { key: 'automotive.tires.forklift', name: 'لاستیک لیفتراک', example: 'توپر' },
        ],
      },
    ],
  },
  {
    key: 'apparel',
    name: 'پوشاک، منسوجات و چرم',
    icon: 'shirt',
    children: [
      {
        key: 'apparel.fabric',
        name: 'پارچه، نخ و الیاف',
        children: [
          { key: 'apparel.fabric.fabric', name: 'پارچه', example: 'کرپ نخ' },
          { key: 'apparel.fabric.yarn', name: 'نخ', example: 'ویسکوز' },
          { key: 'apparel.fabric.cotton', name: 'پنبه', example: 'خام' },
          { key: 'apparel.fabric.textile-trims', name: 'لوازم جانبی نساجی', example: 'سایر' },
          { key: 'apparel.fabric.apparel-trims', name: 'لوازم جانبی پوشاک', example: 'دگمه' },
        ],
      },
      {
        key: 'apparel.clothing',
        name: 'پوشاک آماده',
        children: [
          { key: 'apparel.clothing.men', name: 'لباس مردانه', example: 'تی شرت' },
          { key: 'apparel.clothing.women', name: 'لباس زنانه', example: 'شومیز' },
          { key: 'apparel.clothing.kids', name: 'لباس بچگانه', example: 'پیراهن' },
          { key: 'apparel.clothing.underwear', name: 'لباس زیر', example: 'شورت' },
          { key: 'apparel.clothing.sport', name: 'پوشاک ورزشی', example: 'گرمکن' },
          { key: 'apparel.clothing.corporate', name: 'لباس سازمانی', example: 'ست سازمانی' },
        ],
      },
      {
        key: 'apparel.leather',
        name: 'چرم',
        children: [
          { key: 'apparel.leather.natural', name: 'چرم طبیعی', example: 'چرم بزی' },
          { key: 'apparel.leather.synthetic', name: 'چرم مصنوعی', example: 'چرم PVC' },
          { key: 'apparel.leather.sole', name: 'زیره و کفی', example: 'زیره پلی‌اورتان' },
        ],
      },
      {
        key: 'apparel.bags-shoes',
        name: 'کیف و کفش',
        children: [
          { key: 'apparel.bags-shoes.bag', name: 'کیف', example: 'دستی' },
          { key: 'apparel.bags-shoes.suitcase', name: 'چمدان', example: 'بزرگ' },
          { key: 'apparel.bags-shoes.backpack', name: 'کوله‌پشتی', example: 'کوهنوردی' },
          { key: 'apparel.bags-shoes.wallet', name: 'کیف پول', example: 'چرمی' },
          { key: 'apparel.bags-shoes.sport-bag', name: 'ساک ورزشی', example: 'بزرگ' },
          { key: 'apparel.bags-shoes.cosmetic-bag', name: 'کیف آرایشی بهداشتی', example: 'کوچک' },
          { key: 'apparel.bags-shoes.women', name: 'کفش زنانه', example: 'پیاده روی' },
          { key: 'apparel.bags-shoes.men', name: 'کفش مردانه', example: 'پیاده روی' },
          { key: 'apparel.bags-shoes.sport', name: 'کفش ورزشی', example: 'فوتبال' },
          { key: 'apparel.bags-shoes.kids', name: 'کفش بچگانه', example: 'اسپرت' },
        ],
      },
      {
        key: 'apparel.accessories',
        name: 'اکسسوری، ساعت و عینک',
        children: [
          { key: 'apparel.accessories.hair', name: 'اکسسوری مو', example: 'موگیر' },
          { key: 'apparel.accessories.scarf', name: 'روسری و شال', example: 'حریر' },
          { key: 'apparel.accessories.hat', name: 'کلاه', example: 'بافتنی' },
          { key: 'apparel.accessories.glove', name: 'دستکش', example: 'زنانه' },
          { key: 'apparel.accessories.belt', name: 'کمربند', example: 'چرمی' },
          { key: 'apparel.accessories.watch', name: 'ساعت', example: 'کلاسیک' },
          { key: 'apparel.accessories.glasses', name: 'عینک', example: 'آفتابی' },
          { key: 'apparel.accessories.jewelry', name: 'زیورآلات', example: 'گردنبند' },
        ],
      },
    ],
  },
  {
    key: 'home',
    name: 'خانه، مبلمان و لوازم برقی',
    icon: 'sofa',
    children: [
      {
        key: 'home.appliances',
        name: 'لوازم برقی خانگی',
        children: [
          { key: 'home.appliances.fridge', name: 'یخچال', example: 'دوقلو' },
          { key: 'home.appliances.washer', name: 'لباسشویی', example: 'دوقلو' },
          { key: 'home.appliances.tv', name: 'تلویزیون', example: 'هوشمند' },
          { key: 'home.appliances.cooler', name: 'کولر', example: 'گازی' },
          { key: 'home.appliances.stove', name: 'اجاق گاز', example: 'صفحه ای' },
          { key: 'home.appliances.hood', name: 'هود', example: 'شیشه ای' },
          { key: 'home.appliances.heater', name: 'بخاری', example: 'برقی' },
          { key: 'home.appliances.boiler', name: 'آب گرمکن', example: 'گازی' },
          { key: 'home.appliances.vacuum', name: 'جاروبرقی', example: 'هوشمند' },
        ],
      },
      {
        key: 'home.digital',
        name: 'کالای دیجیتال',
        children: [
          { key: 'home.digital.mobile', name: 'موبایل', example: 'سامسونگ' },
          { key: 'home.digital.laptop', name: 'لپ‌تاپ', example: 'ایسوس' },
          { key: 'home.digital.tablet', name: 'تبلت و کتابخوان', example: 'سامسونگ' },
          { key: 'home.digital.pc', name: 'کامپیوتر و تجهیزات جانبی', example: 'هارد' },
          { key: 'home.digital.camera', name: 'دوربین', example: 'کانن' },
          { key: 'home.digital.mobile-acc', name: 'لوازم جانبی موبایل', example: 'شارژر' },
          { key: 'home.digital.camera-acc', name: 'لوازم جانبی دوربین', example: 'لنز' },
          { key: 'home.digital.network', name: 'مودم و تجهیزات شبکه', example: 'مودم' },
          { key: 'home.digital.office', name: 'ماشین‌های اداری', example: 'اسکنر' },
        ],
      },
      {
        key: 'home.furniture',
        name: 'مبلمان و دکوراسیون',
        children: [
          { key: 'home.furniture.sofa', name: 'مبل', example: 'راحتی' },
          { key: 'home.furniture.bedroom', name: 'سرویس خواب', example: 'تخت خواب' },
          { key: 'home.furniture.chair', name: 'صندلی', example: 'اداری' },
          { key: 'home.furniture.table', name: 'میز', example: 'مطالعه' },
          { key: 'home.furniture.cabinet', name: 'کابینت', example: 'کلاسیک' },
          { key: 'home.furniture.wardrobe', name: 'کمد', example: 'لباس' },
          { key: 'home.furniture.buffet', name: 'بوفه', example: 'کلاسیک' },
          { key: 'home.furniture.carpet', name: 'فرش', example: 'ماشینی' },
          { key: 'home.furniture.curtain', name: 'پرده', example: 'حریر پانچی' },
          { key: 'home.furniture.wallpaper', name: 'کاغذ دیواری', example: 'ضدآب' },
          { key: 'home.furniture.flooring', name: 'کفپوش', example: 'رولی' },
          { key: 'home.furniture.wallcovering', name: 'دیوارپوش', example: 'فومی' },
          { key: 'home.furniture.shelf', name: 'شلف', example: 'دیواری' },
        ],
      },
      {
        key: 'home.kitchen',
        name: 'آشپزخانه و ظروف',
        children: [
          { key: 'home.kitchen.tools', name: 'لوازم آشپزخانه', example: 'فلاسک' },
          { key: 'home.kitchen.cookware', name: 'ظروف پخت و پز', example: 'قابلمه' },
          { key: 'home.kitchen.serving', name: 'ظروف سرو و پذیرایی', example: 'بشقاب' },
          { key: 'home.kitchen.disposable', name: 'ظروف یکبار مصرف', example: 'لیوان یکبار مصرف' },
          { key: 'home.kitchen.bath', name: 'لوازم حمام و سرویس بهداشتی', example: 'حوله' },
        ],
      },
      {
        key: 'home.cleaning',
        name: 'نظافت و شوینده',
        children: [
          { key: 'home.cleaning.detergent', name: 'مواد شوینده', example: 'مایع دستشویی' },
          { key: 'home.cleaning.tissue', name: 'دستمال کاغذی', example: 'دستمال توالت' },
          { key: 'home.cleaning.wash', name: 'لوازم شستشو و نظافت', example: 'طی زمین شوی' },
        ],
      },
      {
        key: 'home.pet',
        name: 'لوازم حیوانات خانگی',
        children: [{ key: 'home.pet.supplies', name: 'لوازم حیوانات خانگی', example: 'غذای گربه' }],
      },
    ],
  },
  {
    key: 'health',
    name: 'سلامت، زیبایی و پزشکی',
    icon: 'heart-pulse',
    children: [
      {
        key: 'health.cosmetics',
        name: 'آرایشی و بهداشتی',
        children: [
          { key: 'health.cosmetics.skin', name: 'محصولات پوستی', example: 'ضد آفتاب' },
          { key: 'health.cosmetics.hair', name: 'محصولات مو', example: 'ماسک مو' },
          { key: 'health.cosmetics.hygiene', name: 'بهداشت شخصی', example: 'نوار بهداشتی' },
          { key: 'health.cosmetics.body', name: 'مراقبت و بهداشت بدن', example: 'بادی اسپلش' },
          { key: 'health.cosmetics.perfume', name: 'عطر و ادکلن', example: 'پرفیوم زنانه' },
        ],
      },
      {
        key: 'health.medical',
        name: 'تجهیزات پزشکی',
        children: [
          { key: 'health.medical.consumable', name: 'تجهیزات پزشکی مصرفی', example: 'ماسک' },
          { key: 'health.medical.specialized', name: 'تجهیزات پزشکی تخصصی', example: 'اتوسکوپ' },
          { key: 'health.medical.home', name: 'تجهیزات پزشکی خانگی', example: 'تب سنج' },
          { key: 'health.medical.orthopedic', name: 'تجهیزات ارتوپدی و حرکتی', example: 'ویلچر' },
        ],
      },
      {
        key: 'health.salon',
        name: 'تجهیزات آرایشگاهی',
        children: [{ key: 'health.salon.equipment', name: 'تجهیزات آرایشگاهی', example: 'تخت ماساژ' }],
      },
    ],
  },
  {
    key: 'sports',
    name: 'ورزش، کودک و سرگرمی',
    icon: 'trophy',
    children: [
      {
        key: 'sports.sport',
        name: 'ورزش و بدنسازی',
        children: [
          { key: 'sports.sport.equipment', name: 'تجهیزات ورزشی', example: 'توپ فوتبال' },
          { key: 'sports.sport.gym', name: 'تجهیزات بدنسازی', example: 'کراس فیت' },
          { key: 'sports.sport.turf', name: 'چمن مصنوعی', example: 'فوتبالی' },
          { key: 'sports.sport.flooring', name: 'کفپوش ورزشی', example: 'سالن' },
        ],
      },
      {
        key: 'sports.outdoor',
        name: 'کوهنوردی و کمپینگ',
        children: [{ key: 'sports.outdoor.outdoor', name: 'تجهیزات کوهنوردی و کمپینگ', example: 'چادر کوهنوردی' }],
      },
      {
        key: 'sports.toys',
        name: 'اسباب‌بازی و بازی',
        children: [
          { key: 'sports.toys.toy', name: 'اسباب‌بازی', example: 'لگو' },
          { key: 'sports.toys.doll', name: 'عروسک', example: 'باربی' },
          { key: 'sports.toys.game', name: 'بازی و سرگرمی', example: 'پازل' },
          { key: 'sports.toys.party', name: 'لوازم مهمانی', example: 'بادکنک' },
        ],
      },
      {
        key: 'sports.baby',
        name: 'نوزاد و کودک',
        children: [
          { key: 'sports.baby.stroller', name: 'کالسکه', example: 'دوقلو' },
          { key: 'sports.baby.dish', name: 'ظروف نوزاد و کودک', example: 'شیشه شیر نوزاد' },
        ],
      },
      {
        key: 'sports.music',
        name: 'ساز و استودیو',
        children: [
          { key: 'sports.music.guitar', name: 'گیتار', example: 'یاماها' },
          { key: 'sports.music.piano', name: 'پیانو', example: 'یاماها' },
          { key: 'sports.music.studio', name: 'تجهیزات استودیو', example: 'کارت صدا' },
        ],
      },
      {
        key: 'sports.gifts',
        name: 'کادو و صنایع دستی',
        children: [
          { key: 'sports.gifts.wood', name: 'صنایع دستی چوبی', example: 'خاتم' },
          { key: 'sports.gifts.metal', name: 'صنایع دستی فلزی', example: 'میناکاری' },
          { key: 'sports.gifts.weave', name: 'بافت', example: 'حصیربافی' },
          { key: 'sports.gifts.textile', name: 'پارچه‌ای و چرمی', example: 'ترمه' },
          { key: 'sports.gifts.gemstone', name: 'سنگ قیمتی', example: 'سنگ عقیق' },
          { key: 'sports.gifts.hand-jewelry', name: 'زیورآلات دست‌ساز', example: 'دستبند' },
          { key: 'sports.gifts.gift', name: 'لوازم کادویی', example: 'گلدان' },
        ],
      },
    ],
  },
];

// ─── کمکی‌های درخت (بدون وابستگی به Nest — برای سرویس و مولد نگاشت) ─────────

export interface FlatTaxonomyNode extends TaxonomyNode {
  level: number;
  parentKey: string | null;
}

/** همهٔ گره‌ها به‌صورت مسطح — ترتیب عمق-اول مثل ظاهر درخت */
export function flattenTaxonomy(roots: TaxonomyNode[] = TAXONOMY_V2_ROOTS): FlatTaxonomyNode[] {
  const out: FlatTaxonomyNode[] = [];
  const walk = (nodes: TaxonomyNode[], level: number, parentKey: string | null) => {
    for (const n of nodes) {
      out.push({ ...n, level, parentKey });
      if (n.children?.length) walk(n.children, level + 1, n.key);
    }
  };
  walk(roots, 1, null);
  return out;
}

/** کلیدهای معتبر تاکسونومی */
export function validTaxonomyKeys(): Set<string> {
  return new Set(flattenTaxonomy().map((n) => n.key));
}

/** گره با کلید داده‌شده (یا null) */
export function findTaxonomyNode(key: string): FlatTaxonomyNode | null {
  return flattenTaxonomy().find((n) => n.key === key) ?? null;
}

/** کلید خود گره + همهٔ فرزندان — با پیشوند نقطه‌گذر */
export function taxonomySubtreeKeys(key: string): string[] {
  const prefix = `${key}.`;
  return flattenTaxonomy()
    .filter((n) => n.key === key || n.key.startsWith(prefix))
    .map((n) => n.key);
}

/** زنجیرهٔ اتریبیوت‌های مؤثر روی یک گره — از ریشه تا خود گره (ارث‌بری) */
export function effectiveAttrs(key: string): TaxonomyAttr[] {
  const chain = flattenTaxonomy().filter((n) => key === n.key || key.startsWith(`${n.key}.`));
  const attrs: TaxonomyAttr[] = [];
  for (const n of chain) if (n.attrs?.length) attrs.push(...n.attrs);
  return attrs;
}

/** مسیر نمایشی نام‌ها — مثل «کشاورزی و باغبانی ← حبوبات ← نخود» */
export function taxonomyPath(key: string): string[] {
  return flattenTaxonomy()
    .filter((n) => key === n.key || key.startsWith(`${n.key}.`))
    .map((n) => n.name);
}
