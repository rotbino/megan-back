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
          { key: 'agri.fruit.apple', name: 'سیب' },
          { key: 'agri.fruit.pear', name: 'گلابی' },
          { key: 'agri.fruit.quince', name: 'به' },
          { key: 'agri.fruit.peach', name: 'هلو و شلیل' },
          { key: 'agri.fruit.apricot', name: 'زردآلو' },
          { key: 'agri.fruit.sour-cherry', name: 'آلبالو' },
          { key: 'agri.fruit.cherry', name: 'گیلاس' },
          { key: 'agri.fruit.grape', name: 'انگور' },
          { key: 'agri.fruit.pomegranate', name: 'انار' },
          { key: 'agri.fruit.fig', name: 'انجیر' },
          { key: 'agri.fruit.strawberry', name: 'توت‌فرنگی' },
          { key: 'agri.fruit.orange', name: 'پرتقال' },
          { key: 'agri.fruit.tangerine', name: 'نارنگی' },
          { key: 'agri.fruit.sour-lemon', name: 'لیمو ترش' },
          { key: 'agri.fruit.sweet-lemon', name: 'لیمو شیرین' },
          { key: 'agri.fruit.grapefruit', name: 'گریپ فروت' },
          { key: 'agri.fruit.kiwi', name: 'کیوی' },
          { key: 'agri.fruit.banana', name: 'موز' },
          { key: 'agri.fruit.mango', name: 'انبه' },
          { key: 'agri.fruit.pineapple', name: 'آناناس' },
          { key: 'agri.fruit.olive', name: 'زیتون' },
          { key: 'agri.fruit.date', name: 'خرما' },
        ],
      },
      {
        key: 'agri.veg',
        name: 'صیفی و سبزی',
        children: [
          { key: 'agri.veg.tomato', name: 'گوجه' },
          { key: 'agri.veg.onion', name: 'پیاز' },
          { key: 'agri.veg.potato', name: 'سیب‌زمینی' },
          { key: 'agri.veg.garlic', name: 'سیر' },
          { key: 'agri.veg.carrot', name: 'هویج' },
          { key: 'agri.veg.cucumber', name: 'خیار' },
          { key: 'agri.veg.eggplant', name: 'بادمجان' },
          { key: 'agri.veg.pepper', name: 'فلفل' },
          { key: 'agri.veg.bell-pepper', name: 'فلفل دلمه‌ای' },
          { key: 'agri.veg.cabbage', name: 'کلم' },
          { key: 'agri.veg.lettuce', name: 'کاهو' },
          { key: 'agri.veg.mushroom', name: 'قارچ' },
          { key: 'agri.veg.okra', name: 'بامیه' },
          { key: 'agri.veg.green-bean', name: 'لوبیا سبز' },
          { key: 'agri.veg.celery', name: 'کرفس' },
          { key: 'agri.veg.turnip', name: 'شلغم' },
          { key: 'agri.veg.squash', name: 'کدو' },
          { key: 'agri.veg.herbs', name: 'سبزی' },
          { key: 'agri.veg.dill', name: 'شوید' },
          { key: 'agri.veg.watermelon', name: 'هندوانه' },
          { key: 'agri.veg.melon', name: 'خربزه' },
          { key: 'agri.veg.cantaloupe', name: 'طالبی' },
        ],
      },
      {
        key: 'agri.grains',
        name: 'غلات',
        children: [
          {
            key: 'agri.grains.rice',
            name: 'برنج',
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
          { key: 'agri.grains.wheat', name: 'گندم' },
          { key: 'agri.grains.barley', name: 'جو' },
          { key: 'agri.grains.corn', name: 'ذرت' },
          { key: 'agri.grains.sesame', name: 'کنجد' },
        ],
      },
      {
        key: 'agri.pulses',
        name: 'حبوبات',
        children: [
          { key: 'agri.pulses.beans', name: 'لوبیا' },
          {
            key: 'agri.pulses.chickpea',
            name: 'نخود',
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
          { key: 'agri.pulses.lentil', name: 'عدس' },
          { key: 'agri.pulses.soy', name: 'سویا' },
          { key: 'agri.pulses.split', name: 'لپه' },
          { key: 'agri.pulses.faba', name: 'باقلا' },
        ],
      },
      {
        key: 'agri.nuts',
        name: 'خشکبار',
        children: [
          { key: 'agri.nuts.pistachio', name: 'پسته' },
          { key: 'agri.nuts.almond', name: 'بادام' },
          { key: 'agri.nuts.walnut', name: 'گردو' },
          { key: 'agri.nuts.hazelnut', name: 'فندق' },
          { key: 'agri.nuts.raisin', name: 'کشمش' },
          { key: 'agri.nuts.barberry', name: 'زرشک' },
          { key: 'agri.nuts.sunflower', name: 'تخمه آفتابگردان' },
          { key: 'agri.nuts.dried-fruit', name: 'میوه خشک' },
          { key: 'agri.nuts.dried-herbs', name: 'سبزی خشک' },
        ],
      },
      {
        key: 'agri.spices',
        name: 'ادویه و گیاهان دارویی',
        children: [
          { key: 'agri.spices.saffron', name: 'زعفران' },
          { key: 'agri.spices.turmeric', name: 'زردچوبه' },
          { key: 'agri.spices.cinnamon', name: 'دارچین' },
          { key: 'agri.spices.black-pepper', name: 'فلفل سیاه' },
          { key: 'agri.spices.cardamom', name: 'هل' },
          { key: 'agri.spices.ginger', name: 'زنجبیل' },
          { key: 'agri.spices.thyme', name: 'آویشن' },
          { key: 'agri.spices.garlic-powder', name: 'پودر سیر' },
          { key: 'agri.spices.chili-powder', name: 'پودر فلفل' },
          { key: 'agri.spices.medicinal', name: 'گیاهان دارویی' },
        ],
      },
      {
        key: 'agri.flowers',
        name: 'گل و گیاه',
        children: [
          { key: 'agri.flowers.cut-flowers', name: 'گل شاخه‌بریده' },
          { key: 'agri.flowers.houseplants', name: 'گیاهان آپارتمانی' },
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
          { key: 'livestock.live.sheep-goat', name: 'گوسفند و بز' },
          { key: 'livestock.live.cattle', name: 'گاو و گوساله' },
          { key: 'livestock.live.poultry', name: 'طیور زنده' },
          { key: 'livestock.live.bee', name: 'زنبور و کلنی' },
        ],
      },
      {
        key: 'livestock.aquatic',
        name: 'آبزیان زنده و بچه‌ماهی',
        children: [
          { key: 'livestock.aquatic.fry', name: 'بچه‌ماهی و تکثیر' },
          { key: 'livestock.aquatic.live-food', name: 'آبزیان زندهٔ خوراکی' },
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
          { key: 'food.beverages.tea', name: 'چای' },
          { key: 'food.beverages.coffee', name: 'قهوه' },
          { key: 'food.beverages.juice', name: 'آبمیوه' },
          { key: 'food.beverages.soda', name: 'نوشابه' },
          { key: 'food.beverages.mineral-water', name: 'آب معدنی' },
          { key: 'food.beverages.herbals', name: 'عرقیات' },
        ],
      },
      {
        key: 'food.protein',
        name: 'مواد پروتئینی',
        children: [
          { key: 'food.protein.meat', name: 'گوشت' },
          { key: 'food.protein.processed-meat', name: 'فرآورده گوشتی' },
          { key: 'food.protein.fish', name: 'ماهی' },
          { key: 'food.protein.shrimp', name: 'میگو' },
          { key: 'food.protein.egg', name: 'تخم مرغ' },
          { key: 'food.protein.quail-egg', name: 'تخم بلدرچین' },
        ],
      },
      {
        key: 'food.dairy',
        name: 'لبنیات',
        children: [
          { key: 'food.dairy.milk', name: 'شیر' },
          { key: 'food.dairy.cheese', name: 'پنیر' },
          { key: 'food.dairy.yogurt', name: 'ماست' },
          { key: 'food.dairy.butter', name: 'کره' },
          { key: 'food.dairy.kashk', name: 'کشک' },
          { key: 'food.dairy.ice-cream', name: 'بستنی' },
        ],
      },
      {
        key: 'food.snacks',
        name: 'تنقلات و شیرینی',
        children: [
          {
            key: 'food.snacks.puff',
            name: 'پفک',
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
          { key: 'food.snacks.chips', name: 'چیپس' },
          { key: 'food.snacks.biscuit', name: 'بیسکویت' },
          { key: 'food.snacks.chocolate', name: 'شکلات' },
          { key: 'food.snacks.cake', name: 'کیک و کلوچه' },
          { key: 'food.snacks.gum', name: 'آدامس' },
          { key: 'food.snacks.pastille', name: 'پاستیل' },
          { key: 'food.snacks.lavashak', name: 'لواشک' },
          { key: 'food.snacks.nabat', name: 'نبات' },
        ],
      },
      {
        key: 'food.bakery',
        name: 'نان و ماکارونی',
        children: [
          { key: 'food.bakery.bread', name: 'نان' },
          { key: 'food.bakery.pasta', name: 'ماکارونی' },
        ],
      },
      {
        key: 'food.ingredients',
        name: 'مواد اولیه و چاشنی',
        children: [
          { key: 'food.ingredients.oil', name: 'روغن خوراکی' },
          { key: 'food.ingredients.sugar', name: 'شکر' },
          { key: 'food.ingredients.cube-sugar', name: 'قند' },
          { key: 'food.ingredients.salt', name: 'نمک' },
          { key: 'food.ingredients.flour', name: 'آرد' },
          { key: 'food.ingredients.starch', name: 'نشاسته' },
          { key: 'food.ingredients.vinegar', name: 'سرکه' },
          { key: 'food.ingredients.lime-juice', name: 'آبلیمو' },
          { key: 'food.ingredients.ardé', name: 'ارده' },
          { key: 'food.ingredients.milk-powder', name: 'شیر خشک' },
          { key: 'food.ingredients.confectionery', name: 'مواد اولیه قنادی' },
        ],
      },
      {
        key: 'food.canned',
        name: 'کنسرو و غذای آماده',
        children: [
          {
            key: 'food.canned.tuna',
            name: 'تن ماهی',
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
          { key: 'food.canned.tomato-paste', name: 'رب گوجه‌فرنگی' },
          { key: 'food.canned.pickles', name: 'ترشی' },
          { key: 'food.canned.pickled-cucumber', name: 'خیارشور' },
          { key: 'food.canned.jam', name: 'مربا' },
          { key: 'food.canned.concentrate', name: 'کنسانتره میوه' },
          { key: 'food.canned.ready-meal', name: 'غذای نیمه‌آماده' },
        ],
      },
      { key: 'food.honey', name: 'عسل و فرآورده‌های زنبور' },
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
          { key: 'inputs.fertilizer.urea', name: 'کود اوره' },
          { key: 'inputs.fertilizer.phosphate', name: 'کود فسفاته' },
          { key: 'inputs.fertilizer.potash', name: 'کود پتاسه' },
          { key: 'inputs.fertilizer.npk', name: 'کود کامل (NPK)' },
          { key: 'inputs.fertilizer.organic', name: 'کود آلی و دامی' },
          { key: 'inputs.fertilizer.liquid', name: 'کود مایع' },
        ],
      },
      {
        key: 'inputs.pesticide',
        name: 'سم و آفت‌کش',
        children: [
          { key: 'inputs.pesticide.insecticide', name: 'سم' },
          { key: 'inputs.pesticide.pesticide', name: 'آفت‌کش' },
          { key: 'inputs.pesticide.fungicide', name: 'قارچ‌کش' },
          { key: 'inputs.pesticide.herbicide', name: 'علف‌کش' },
          { key: 'inputs.pesticide.hormone', name: 'هورمون و محرک رشد' },
        ],
      },
      {
        key: 'inputs.seed',
        name: 'بذر و نهال',
        children: [
          { key: 'inputs.seed.seed', name: 'بذر' },
          { key: 'inputs.seed.seedling', name: 'نهال' },
        ],
      },
      {
        key: 'inputs.feed',
        name: 'خوراک و علوفهٔ دام',
        children: [
          { key: 'inputs.feed.livestock', name: 'خوراک دام' },
          { key: 'inputs.feed.alfalfa', name: 'یونجه' },
          { key: 'inputs.feed.straw', name: 'کاه' },
          { key: 'inputs.feed.bran', name: 'کنجاله و سبوس' },
        ],
      },
      {
        key: 'inputs.supplies',
        name: 'پلاستیک و ملزومات کشاورزی',
        children: [
          { key: 'inputs.supplies.agri-plastic', name: 'پلاستیک کشاورزی' },
          { key: 'inputs.supplies.seedling-tray', name: 'سینی نشا' },
          { key: 'inputs.supplies.shade-net', name: 'تور و سایه‌بان' },
        ],
      },
      {
        key: 'inputs.pet-food',
        name: 'خوراک حیوانات خانگی',
        children: [
          { key: 'inputs.pet-food.cat', name: 'خوراک گربه' },
          { key: 'inputs.pet-food.dog', name: 'خوراک سگ' },
          { key: 'inputs.pet-food.bird-fish', name: 'خوراک پرنده و آبزی' },
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
          { key: 'machinery.agri.tractor', name: 'تراکتور' },
          { key: 'machinery.agri.tiller', name: 'تیلر' },
          { key: 'machinery.agri.sprayer', name: 'سمپاش' },
          { key: 'machinery.agri.harvester', name: 'دروگر' },
          { key: 'machinery.agri.seeder', name: 'بذرکار' },
          { key: 'machinery.agri.rotavator', name: 'روتیواتور' },
          { key: 'machinery.agri.cultivator', name: 'کولتیواتور' },
          { key: 'machinery.agri.trailer', name: 'تریلر کشاورزی' },
          { key: 'machinery.agri.implements', name: 'ادوات کشاورزی' },
          { key: 'machinery.agri.irrigation', name: 'تجهیزات آبیاری' },
          { key: 'machinery.agri.greenhouse', name: 'تجهیزات گلخانه' },
          { key: 'machinery.agri.livestock-tools', name: 'لوازم دامداری' },
          { key: 'machinery.agri.gardening', name: 'ابزار باغبانی' },
          { key: 'machinery.agri.incubator', name: 'دستگاه جوجه‌کشی' },
          { key: 'machinery.agri.feed-mill', name: 'دستگاه خوراک دام' },
          { key: 'machinery.agri.milker', name: 'دستگاه شیردوش دام' },
          { key: 'machinery.agri.grader', name: 'دستگاه بوجاری' },
        ],
      },
      {
        key: 'machinery.food',
        name: 'تجهیزات صنایع غذایی',
        children: [
          { key: 'machinery.food.cooking', name: 'تجهیزات پخت' },
          { key: 'machinery.food.oven', name: 'فر صنعتی' },
          { key: 'machinery.food.mixer', name: 'همزن صنعتی' },
          { key: 'machinery.food.fryer', name: 'دستگاه سرخ‌کن صنعتی' },
          { key: 'machinery.food.dairy', name: 'تجهیزات فرآوری لبنیات' },
          { key: 'machinery.food.meat', name: 'تجهیزات فرآوری گوشت' },
          { key: 'machinery.food.fruit-veg', name: 'تجهیزات فرآوری میوه و سبزی' },
          { key: 'machinery.food.grain', name: 'تجهیزات فرآوری غلات' },
          { key: 'machinery.food.nuts', name: 'دستگاه فرآوری خشکبار' },
          { key: 'machinery.food.honey', name: 'دستگاه فرآوری عسل' },
        ],
      },
      {
        key: 'machinery.packaging',
        name: 'ماشین‌آلات بسته‌بندی و پرکن',
        children: [
          { key: 'machinery.packaging.filler', name: 'دستگاه پرکن' },
          { key: 'machinery.packaging.shrink', name: 'دستگاه شرینک' },
          { key: 'machinery.packaging.vacuum', name: 'دستگاه وکیوم بسته‌بندی' },
          { key: 'machinery.packaging.sealer', name: 'دستگاه دوخت پلاستیک' },
          { key: 'machinery.packaging.labeler', name: 'دستگاه لیبل‌زن' },
          { key: 'machinery.packaging.inkjet', name: 'جت پرینتر' },
          { key: 'machinery.packaging.laminator', name: 'دستگاه لمینیت' },
          { key: 'machinery.packaging.line', name: 'خط بسته‌بندی' },
          { key: 'machinery.packaging.parts', name: 'قطعات تجهیزات بسته‌بندی' },
        ],
      },
      {
        key: 'machinery.printing',
        name: 'ماشین‌آلات چاپ',
        children: [
          { key: 'machinery.printing.press', name: 'دستگاه چاپ' },
          { key: 'machinery.printing.digital', name: 'پرینتر دیجیتالی' },
          { key: 'machinery.printing.offset', name: 'پرینتر افست' },
          { key: 'machinery.printing.3d', name: 'پرینتر سه‌بعدی' },
          { key: 'machinery.printing.heat-press', name: 'دستگاه پرس حرارتی' },
          { key: 'machinery.printing.parts', name: 'قطعات دستگاه چاپ' },
        ],
      },
      {
        key: 'machinery.sewing',
        name: 'ماشین‌آلات دوخت و نساجی',
        children: [
          { key: 'machinery.sewing.machine', name: 'چرخ خیاطی' },
          { key: 'machinery.sewing.flatseam', name: 'چرخ سردوز' },
          { key: 'machinery.sewing.knitting', name: 'دستگاه بافندگی' },
          { key: 'machinery.sewing.weaving', name: 'دستگاه بافت' },
          { key: 'machinery.sewing.cutter', name: 'دستگاه برش پارچه' },
          { key: 'machinery.sewing.shoemaking', name: 'دستگاه تولید کفش' },
        ],
      },
      {
        key: 'machinery.workshop',
        name: 'ماشین‌آلات کارگاهی',
        children: [
          { key: 'machinery.workshop.injection', name: 'دستگاه تزریق پلاستیک' },
          { key: 'machinery.workshop.nylon', name: 'دستگاه تولید نایلون' },
          { key: 'machinery.workshop.compressor', name: 'کمپرسور' },
          { key: 'machinery.workshop.furnace', name: 'کوره' },
          { key: 'machinery.workshop.lathe', name: 'دستگاه تراش' },
          { key: 'machinery.workshop.cutter', name: 'دستگاه برش' },
          { key: 'machinery.workshop.mill', name: 'آسیاب پلاستیک' },
          { key: 'machinery.workshop.laser', name: 'دستگاه لیزر' },
          { key: 'machinery.workshop.scale', name: 'پاسکال' },
          { key: 'machinery.workshop.press', name: 'دستگاه پرس' },
          { key: 'machinery.workshop.cnc', name: 'دستگاه سی‌ان‌سی' },
          { key: 'machinery.workshop.drill', name: 'دستگاه حفاری' },
          { key: 'machinery.workshop.turning', name: 'دستگاه خراطی' },
          { key: 'machinery.workshop.plating', name: 'دستگاه آبکاری' },
          { key: 'machinery.workshop.guillotine', name: 'دستگاه گیوتین' },
          { key: 'machinery.workshop.pvc', name: 'دستگاه پی‌وی‌سی' },
          { key: 'machinery.workshop.rolling', name: 'دستگاه نورد' },
          { key: 'machinery.workshop.carton', name: 'دستگاه کارتن‌سازی' },
        ],
      },
      {
        key: 'machinery.construction',
        name: 'ماشین‌آلات راه، ساختمان و معدن',
        children: [
          { key: 'machinery.construction.excavator', name: 'بیل مکانیکی' },
          { key: 'machinery.construction.loader', name: 'لودر' },
          { key: 'machinery.construction.dozer', name: 'بلدوزر' },
          { key: 'machinery.construction.crane', name: 'جرثقیل' },
          { key: 'machinery.construction.mixer', name: 'میکسر بتن' },
          { key: 'machinery.construction.pump', name: 'پمپ بتن' },
          { key: 'machinery.construction.block-machine', name: 'دستگاه بلوک‌زن' },
          { key: 'machinery.construction.mold', name: 'قالب بتن' },
          { key: 'machinery.construction.hoist', name: 'بالابر ساختمان' },
          { key: 'machinery.construction.jack', name: 'جک سقفی' },
          { key: 'machinery.construction.crusher', name: 'دستگاه سنگ‌شکن' },
          { key: 'machinery.construction.trowel', name: 'ماله برقی' },
          { key: 'machinery.construction.rebar', name: 'دستگاه خاموت‌زن' },
        ],
      },
      {
        key: 'machinery.hvac',
        name: 'تهویه، سرمایش و گرمایش',
        children: [
          { key: 'machinery.hvac.heating', name: 'تجهیزات گرمایشی' },
          { key: 'machinery.hvac.cooling', name: 'تجهیزات سرمایشی' },
          { key: 'machinery.hvac.ventilation', name: 'تجهیزات تهویه' },
          { key: 'machinery.hvac.fan', name: 'هواکش' },
          { key: 'machinery.hvac.boiler', name: 'دیگ بخار' },
          { key: 'machinery.hvac.cooling-tower', name: 'برج خنک‌کننده' },
          { key: 'machinery.hvac.exchanger', name: 'تجهیزات تبدیل حرارت' },
          { key: 'machinery.hvac.parts', name: 'قطعات سرمایشی و گرمایشی' },
        ],
      },
      {
        key: 'machinery.cleaning',
        name: 'تجهیزات پاکسازی و تصفیه',
        children: [
          { key: 'machinery.cleaning.water-treatment', name: 'دستگاه تصفیه آب' },
          { key: 'machinery.cleaning.water-filter', name: 'فیلتر تصفیه آب' },
          { key: 'machinery.cleaning.carwash', name: 'دستگاه کارواش' },
          { key: 'machinery.cleaning.rug-wash', name: 'دستگاه قالیشویی' },
          { key: 'machinery.cleaning.vacuum', name: 'جاروبرقی صنعتی' },
          { key: 'machinery.cleaning.air-purifier', name: 'دستگاه تصفیه هوا' },
          { key: 'machinery.cleaning.air-filter', name: 'فیلتر تصفیه هوا' },
          { key: 'machinery.cleaning.ozone', name: 'دستگاه ازن‌ساز' },
          { key: 'machinery.cleaning.oxygen', name: 'دستگاه تولید اکسیژن' },
          { key: 'machinery.cleaning.disinfection', name: 'دستگاه ضدعفونی‌کننده' },
          { key: 'machinery.cleaning.desalination', name: 'آب‌شیرین‌کن صنعتی' },
        ],
      },
      {
        key: 'machinery.energy',
        name: 'تجهیزات انرژی',
        children: [
          { key: 'machinery.energy.generator', name: 'ژنراتور' },
          { key: 'machinery.energy.solar', name: 'پنل خورشیدی' },
          { key: 'machinery.energy.inverter', name: 'اینورتر خورشیدی' },
          { key: 'machinery.energy.ups', name: 'برق اضطراری' },
          { key: 'machinery.energy.transformer', name: 'ترانس برق' },
        ],
      },
      {
        key: 'machinery.handling',
        name: 'انبارداری و جابه‌جایی',
        children: [
          { key: 'machinery.handling.forklift', name: 'لیفتراک' },
          { key: 'machinery.handling.stacker', name: 'استاکر و پالت‌تراک' },
          { key: 'machinery.handling.trolley', name: 'ترولی و جابه‌جایی' },
          { key: 'machinery.handling.racking', name: 'قفسه و رک انبار' },
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
          { key: 'tools.hand.hand', name: 'ابزار دستی' },
          { key: 'tools.hand.power', name: 'ابزار برقی' },
          { key: 'tools.hand.air', name: 'ابزار بادی' },
          { key: 'tools.hand.hydraulic', name: 'ابزار هیدرولیک' },
          { key: 'tools.hand.drill', name: 'مته' },
          { key: 'tools.hand.sandpaper', name: 'سنباده' },
          { key: 'tools.hand.toolbox', name: 'جعبه ابزار' },
        ],
      },
      {
        key: 'tools.welding',
        name: 'ابزار جوش و برش',
        children: [{ key: 'tools.welding.weld', name: 'ابزار جوش' }],
      },
      {
        key: 'tools.fittings',
        name: 'لوله، اتصالات و یراق',
        children: [
          { key: 'tools.fittings.pipe', name: 'لوله و اتصالات' },
          { key: 'tools.fittings.hardware', name: 'یراق‌آلات' },
        ],
      },
      {
        key: 'tools.pumps',
        name: 'پمپ و شیرآلات صنعتی',
        children: [
          { key: 'tools.pumps.pump', name: 'پمپ' },
          { key: 'tools.pumps.valve', name: 'شیرآلات صنعتی' },
        ],
      },
      {
        key: 'tools.electrical',
        name: 'برق و تأسیسات برقی',
        children: [
          { key: 'tools.electrical.cable', name: 'کابل' },
          { key: 'tools.electrical.wire', name: 'سیم' },
          { key: 'tools.electrical.battery', name: 'باتری' },
          { key: 'tools.electrical.contactor', name: 'کنتاکتور' },
          { key: 'tools.electrical.fuse', name: 'فیوز' },
          { key: 'tools.electrical.switch', name: 'کلید و پریز' },
          { key: 'tools.electrical.adapter', name: 'آداپتور' },
        ],
      },
      {
        key: 'tools.automation',
        name: 'اتوماسیون و الکترونیک صنعتی',
        children: [
          { key: 'tools.automation.plc', name: 'پی‌ال‌سی و کنترلر' },
          { key: 'tools.automation.drive', name: 'اینورتر و درایو' },
          { key: 'tools.automation.sensor', name: 'سنسور و ترانسمیتر' },
        ],
      },
      {
        key: 'tools.safety',
        name: 'ایمنی و حفاظت کار',
        children: [
          { key: 'tools.safety.clothing', name: 'لباس و کفش ایمنی' },
          { key: 'tools.safety.glove', name: 'دستکش ایمنی' },
          { key: 'tools.safety.helmet', name: 'کلاه ایمنی' },
          { key: 'tools.safety.glasses', name: 'عینک ایمنی' },
          { key: 'tools.safety.mask', name: 'ماسک و حفاظت تنفسی' },
          { key: 'tools.safety.fall', name: 'حفاظت از سقوط' },
          { key: 'tools.safety.fire', name: 'کپسول و آتش‌نشانی' },
        ],
      },
      {
        key: 'tools.lab',
        name: 'آزمایشگاهی و اندازه‌گیری',
        children: [
          { key: 'tools.lab.glassware', name: 'شیشه آزمایشگاهی' },
          { key: 'tools.lab.measure', name: 'تجهیزات اندازه‌گیری دقیق' },
        ],
      },
      {
        key: 'tools.surveillance',
        name: 'تجهیزات نظارتی',
        children: [
          { key: 'tools.surveillance.camera', name: 'دوربین مداربسته' },
          { key: 'tools.surveillance.recorder', name: 'تجهیزات ضبط و شبکه' },
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
          { key: 'packaging.materials.carton', name: 'کارتن' },
          { key: 'packaging.materials.box', name: 'جعبه' },
          { key: 'packaging.materials.paper', name: 'کاغذ' },
          { key: 'packaging.materials.bottle', name: 'بطری' },
          { key: 'packaging.materials.barrel', name: 'بشکه' },
          { key: 'packaging.materials.jumbo', name: 'جامبو بگ' },
          { key: 'packaging.materials.pallet', name: 'پالت' },
          { key: 'packaging.materials.basket', name: 'سبد' },
          { key: 'packaging.materials.plastic', name: 'بسته‌بندی پلاستیکی' },
          { key: 'packaging.materials.metal', name: 'بسته‌بندی فلزی' },
        ],
      },
      {
        key: 'packaging.film',
        name: 'سلفون، نایلون و فیلم',
        children: [
          { key: 'packaging.film.nyloon', name: 'نایلون' },
          { key: 'packaging.film.cellophane', name: 'سلفون' },
          { key: 'packaging.film.roll', name: 'رول پلاستیک' },
          { key: 'packaging.film.foil', name: 'فویل آلومینیومی' },
        ],
      },
      {
        key: 'packaging.print',
        name: 'خدمات چاپ و لیبل',
        children: [
          { key: 'packaging.print.print', name: 'خدمات چاپ' },
          { key: 'packaging.print.label', name: 'لیبل و استیکر' },
        ],
      },
      {
        key: 'packaging.stationery',
        name: 'نوشت‌افزار و ملزومات اداری',
        children: [
          { key: 'packaging.stationery.notebook', name: 'دفتر' },
          { key: 'packaging.stationery.pencil', name: 'مداد' },
          { key: 'packaging.stationery.pen', name: 'خودکار' },
          { key: 'packaging.stationery.marker', name: 'ماژیک' },
          { key: 'packaging.stationery.binder', name: 'زونکن' },
          { key: 'packaging.stationery.set', name: 'ست اداری' },
          { key: 'packaging.stationery.whiteboard', name: 'وایت‌برد' },
          { key: 'packaging.stationery.calculator', name: 'ماشین حساب' },
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
          { key: 'construction.materials.cement', name: 'سیمان' },
          { key: 'construction.materials.gypsum', name: 'گچ' },
          { key: 'construction.materials.brick', name: 'آجر' },
          { key: 'construction.materials.block', name: 'بلوک' },
          { key: 'construction.materials.sand', name: 'شن و ماسه' },
          { key: 'construction.materials.joist-block', name: 'تیرچه بلوک' },
          { key: 'construction.materials.foam', name: 'فوم ساختمانی' },
          { key: 'construction.materials.precast', name: 'دیوار پیش‌ساخته' },
          { key: 'construction.materials.drywall', name: 'کناف' },
        ],
      },
      {
        key: 'construction.stone',
        name: 'سنگ، کاشی و سرامیک',
        children: [
          { key: 'construction.stone.stone', name: 'سنگ ساختمانی' },
          { key: 'construction.stone.tile', name: 'کاشی و سرامیک' },
        ],
      },
      {
        key: 'construction.wood',
        name: 'چوب',
        children: [
          { key: 'construction.wood.timber', name: 'چوب خام و الوار' },
          { key: 'construction.wood.mdf', name: 'ام‌دی‌اف و نئوپان' },
        ],
      },
      {
        key: 'construction.openings',
        name: 'درب و پنجره',
        children: [
          { key: 'construction.openings.door-window', name: 'درب و پنجره' },
          { key: 'construction.openings.railing', name: 'نرده و حفاظ' },
          { key: 'construction.openings.elevator', name: 'آسانسور' },
        ],
      },
      {
        key: 'construction.insulation',
        name: 'عایق و نسوز',
        children: [
          { key: 'construction.insulation.insulation', name: 'عایق' },
          { key: 'construction.insulation.rockwool', name: 'پشم سنگ' },
          { key: 'construction.insulation.glasswool', name: 'پشم شیشه' },
          { key: 'construction.insulation.refractory', name: 'ورق نسوز' },
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
              { key: 'construction.mep.lighting.lamp', name: 'لامپ' },
              { key: 'construction.mep.lighting.light', name: 'چراغ' },
              { key: 'construction.mep.lighting.chandelier', name: 'لوستر' },
              { key: 'construction.mep.lighting.projector', name: 'پروژکتور' },
              { key: 'construction.mep.lighting.abajur', name: 'آباژور' },
              { key: 'construction.mep.lighting.string', name: 'ریسه' },
              { key: 'construction.mep.lighting.pole', name: 'پایه چراغ' },
            ],
          },
          {
            key: 'construction.mep.sanitary',
            name: 'شیرآلات و سانیتری',
            children: [
              { key: 'construction.mep.sanitary.faucet', name: 'شیرآلات' },
              { key: 'construction.mep.sanitary.washbasin', name: 'روشویی و دستشویی' },
              { key: 'construction.mep.sanitary.sink', name: 'سینک' },
              { key: 'construction.mep.sanitary.flush', name: 'سیفون' },
            ],
          },
          { key: 'construction.mep.plumbing', name: 'سایر تأسیسات ساختمان' },
        ],
      },
      {
        key: 'construction.equipment',
        name: 'تجهیزات ساختمانی',
        children: [
          { key: 'construction.equipment.ladder', name: 'نردبان و داربست' },
          { key: 'construction.equipment.dripper', name: 'آبچکان' },
          { key: 'construction.equipment.fireplace', name: 'شومینه' },
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
          { key: 'metals.steel.rebar', name: 'میلگرد' },
          { key: 'metals.steel.beam', name: 'تیرآهن' },
          { key: 'metals.steel.sheet', name: 'ورق آهنی' },
          { key: 'metals.steel.galvanized', name: 'ورق گالوانیزه' },
          { key: 'metals.steel.pipe', name: 'لوله آهنی' },
          { key: 'metals.steel.box', name: 'قوطی آهن' },
          { key: 'metals.steel.angle', name: 'نبشی' },
          { key: 'metals.steel.channel', name: 'ناودانی' },
          { key: 'metals.steel.profile', name: 'پروفیل' },
          { key: 'metals.steel.mesh', name: 'توری آهنی' },
          { key: 'metals.steel.fence', name: 'فنس' },
          { key: 'metals.steel.barbed', name: 'سیم خاردار' },
          { key: 'metals.steel.ingot', name: 'شمش فولاد' },
          { key: 'metals.steel.steel', name: 'فولاد' },
        ],
      },
      {
        key: 'metals.stainless',
        name: 'استیل',
        children: [
          { key: 'metals.stainless.sheet', name: 'ورق استیل' },
          { key: 'metals.stainless.pipe', name: 'لوله استیل' },
          { key: 'metals.stainless.rebar', name: 'میلگرد استیل' },
          { key: 'metals.stainless.fittings', name: 'اتصالات استیل' },
          { key: 'metals.stainless.profile', name: 'پروفیل استیل' },
        ],
      },
      {
        key: 'metals.aluminum',
        name: 'آلومینیوم',
        children: [
          { key: 'metals.aluminum.ingot', name: 'شمش آلومینیوم' },
          { key: 'metals.aluminum.profile', name: 'پروفیل آلومینیوم' },
          { key: 'metals.aluminum.sheet', name: 'ورق آلومینیوم' },
          { key: 'metals.aluminum.pipe', name: 'لوله آلومینیوم' },
          { key: 'metals.aluminum.box', name: 'قوطی آلومینیومی' },
          { key: 'metals.aluminum.angle', name: 'نبشی آلومینیومی' },
          { key: 'metals.aluminum.cable', name: 'کابل آلومینیومی' },
          { key: 'metals.aluminum.powder', name: 'پودر آلومینیوم' },
        ],
      },
      {
        key: 'metals.copper',
        name: 'مس، برنج و آلیاژها',
        children: [
          { key: 'metals.copper.copper', name: 'مس' },
          { key: 'metals.copper.brass', name: 'فلز برنج' },
          { key: 'metals.copper.lead', name: 'سرب' },
          { key: 'metals.copper.nickel', name: 'نیکل' },
        ],
      },
      {
        key: 'metals.ore',
        name: 'کانی و کنسانترهٔ فلزی',
        children: [
          { key: 'metals.ore.iron', name: 'سنگ آهن' },
          { key: 'metals.ore.pellet', name: 'گندله آهن' },
          { key: 'metals.ore.copper', name: 'سنگ مس' },
          { key: 'metals.ore.lead', name: 'سنگ سرب' },
          { key: 'metals.ore.magnetite', name: 'سنگ مگنتیت' },
          { key: 'metals.ore.chrome', name: 'سنگ کروم' },
          { key: 'metals.ore.chromite', name: 'سنگ کرومیت' },
          { key: 'metals.ore.manganese', name: 'سنگ منگنز' },
        ],
      },
      {
        key: 'metals.scrap',
        name: 'ضایعات و بازیافت',
        children: [
          { key: 'metals.scrap.iron', name: 'ضایعات آهن' },
          { key: 'metals.scrap.steel', name: 'ضایعات فولاد' },
          { key: 'metals.scrap.copper', name: 'ضایعات مس' },
          { key: 'metals.scrap.brass', name: 'ضایعات برنج' },
          { key: 'metals.scrap.stainless', name: 'ضایعات استیل' },
          { key: 'metals.scrap.nickel', name: 'ضایعات نیکل' },
          { key: 'metals.scrap.plastic', name: 'ضایعات پلاستیک' },
          { key: 'metals.scrap.pet', name: 'ضایعات پت' },
          { key: 'metals.scrap.paper', name: 'ضایعات کاغذ' },
          { key: 'metals.scrap.carton', name: 'ضایعات کارتن' },
          { key: 'metals.scrap.glass', name: 'ضایعات شیشه' },
          { key: 'metals.scrap.rubber', name: 'ضایعات لاستیک' },
          { key: 'metals.scrap.e-waste', name: 'ضایعات الکترونیکی' },
          { key: 'metals.scrap.battery', name: 'ضایعات باطری' },
          { key: 'metals.scrap.faucet', name: 'ضایعات شیرآلات' },
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
          { key: 'chemicals.paint.industrial', name: 'رنگ صنعتی' },
          { key: 'chemicals.paint.oil', name: 'رنگ روغن' },
          { key: 'chemicals.paint.acrylic', name: 'رنگ اکریلیک' },
          { key: 'chemicals.paint.plastic', name: 'رنگ پلاستیک' },
          { key: 'chemicals.paint.epoxy', name: 'رنگ اپوکسی' },
          { key: 'chemicals.paint.polyurethane', name: 'رنگ پلی‌اورتان' },
          { key: 'chemicals.paint.polyester', name: 'رنگ پلی‌استر' },
          { key: 'chemicals.paint.refractory', name: 'رنگ نسوز' },
          { key: 'chemicals.paint.wood', name: 'رنگ چوب' },
          { key: 'chemicals.paint.powder', name: 'پودر رنگ' },
          { key: 'chemicals.paint.spray', name: 'اسپری رنگ' },
          { key: 'chemicals.paint.putty', name: 'بتونه' },
          { key: 'chemicals.paint.resin', name: 'رزین' },
          { key: 'chemicals.paint.epoxy-resin', name: 'رزین اپوکسی' },
          { key: 'chemicals.paint.pu-resin', name: 'رزین پلی‌اورتان' },
          { key: 'chemicals.paint.thinner', name: 'تینر' },
          { key: 'chemicals.paint.solvent', name: 'حلال رنگ' },
          { key: 'chemicals.paint.resin-solvent', name: 'حلال رزین' },
          { key: 'chemicals.paint.mold', name: 'قالب رزین' },
          { key: 'chemicals.paint.fiberglass', name: 'فایبرگلاس' },
          { key: 'chemicals.paint.fiberglass-sheet', name: 'ورق فایبرگلاس' },
          { key: 'chemicals.paint.foam-spray', name: 'اسپری فوم' },
          { key: 'chemicals.paint.silicone-spray', name: 'اسپری سیلیکون' },
          { key: 'chemicals.paint.hardener', name: 'هاردنر' },
        ],
      },
      {
        key: 'chemicals.industrial',
        name: 'مواد شیمیایی صنعتی',
        children: [
          { key: 'chemicals.industrial.sulfur', name: 'گوگرد' },
          { key: 'chemicals.industrial.urea', name: 'اوره' },
          { key: 'chemicals.industrial.caustic', name: 'سود پرک' },
          { key: 'chemicals.industrial.soda', name: 'سودا اش' },
          { key: 'chemicals.industrial.carbonate', name: 'کربنات سدیم' },
          { key: 'chemicals.industrial.bicarbonate', name: 'بیکربنات سدیم' },
          { key: 'chemicals.industrial.citric', name: 'اسید سیتریک' },
          { key: 'chemicals.industrial.sulfuric', name: 'اسید سولفوریک' },
          { key: 'chemicals.industrial.phosphoric', name: 'اسید فسفریک' },
          { key: 'chemicals.industrial.peroxide', name: 'آب اکسیژنه' },
          { key: 'chemicals.industrial.alcohol', name: 'الکل صنعتی' },
          { key: 'chemicals.industrial.ethanol', name: 'اتانول صنعتی' },
          { key: 'chemicals.industrial.acetone', name: 'استون' },
          { key: 'chemicals.industrial.propylene', name: 'پروپیلن گلیکول' },
          { key: 'chemicals.industrial.titanium', name: 'تیتانیوم دی‌اکسید' },
          { key: 'chemicals.industrial.polyelectrolyte', name: 'پلی‌الکترولیت' },
          { key: 'chemicals.industrial.permanganate', name: 'پرمنگنات پتاسیم' },
          { key: 'chemicals.industrial.ketrak', name: 'کتراک' },
          { key: 'chemicals.industrial.oxygen', name: 'گاز اکسیژن' },
          { key: 'chemicals.industrial.nitrogen', name: 'گاز نیتروژن' },
          { key: 'chemicals.industrial.acetylene', name: 'گاز استیلن' },
          { key: 'chemicals.industrial.chlorine', name: 'گاز کلر' },
          { key: 'chemicals.industrial.h2s', name: 'سولفید هیدروژن' },
          { key: 'chemicals.industrial.agar', name: 'آگار' },
        ],
      },
      {
        key: 'chemicals.minerals',
        name: 'کانی و مواد معدنی',
        children: [
          { key: 'chemicals.minerals.silica', name: 'سیلیس' },
          { key: 'chemicals.minerals.limestone', name: 'سنگ آهک' },
          { key: 'chemicals.minerals.barite', name: 'سنگ باریت' },
          { key: 'chemicals.minerals.quartz', name: 'کوارتز' },
          { key: 'chemicals.minerals.graphite', name: 'سنگ گرافیت' },
          { key: 'chemicals.minerals.carbide', name: 'کاربید' },
        ],
      },
      {
        key: 'chemicals.polymers',
        name: 'پلاستیک و پلیمر',
        children: [
          { key: 'chemicals.polymers.pe', name: 'پلی‌اتیلن' },
          { key: 'chemicals.polymers.ps', name: 'پلی‌استایرن' },
          { key: 'chemicals.polymers.polymer', name: 'مواد پلیمری' },
          { key: 'chemicals.polymers.raw-plastic', name: 'مواد اولیه پلاستیک' },
          { key: 'chemicals.polymers.pu', name: 'مواد پلی‌یورتان' },
          { key: 'chemicals.polymers.tissue', name: 'مواد اولیه دستمال کاغذی' },
        ],
      },
      {
        key: 'chemicals.rubber',
        name: 'لاستیک صنعتی',
        children: [
          { key: 'chemicals.rubber.hose', name: 'شیلنگ' },
          { key: 'chemicals.rubber.sheet', name: 'ورق لاستیکی' },
          { key: 'chemicals.rubber.bumper', name: 'ضربه‌گیر لاستیکی' },
          { key: 'chemicals.rubber.washer', name: 'واشر لاستیکی' },
        ],
      },
      {
        key: 'chemicals.glass',
        name: 'شیشه',
        children: [
          { key: 'chemicals.glass.building', name: 'شیشه ساختمانی' },
          { key: 'chemicals.glass.secured', name: 'شیشه سکوریت' },
          { key: 'chemicals.glass.double', name: 'شیشه دو جداره' },
          { key: 'chemicals.glass.laminated', name: 'شیشه لمینت' },
          { key: 'chemicals.glass.colored', name: 'شیشه رنگی' },
          { key: 'chemicals.glass.matted', name: 'شیشه مات' },
          { key: 'chemicals.glass.refractory', name: 'شیشه نسوز' },
          { key: 'chemicals.glass.polycarbonate', name: 'شیشه پلی‌کربنات' },
          { key: 'chemicals.glass.mirror', name: 'آینه' },
          { key: 'chemicals.glass.fiber', name: 'الیاف شیشه' },
          { key: 'chemicals.glass.pipe', name: 'لوله شیشه‌ای' },
        ],
      },
      {
        key: 'chemicals.adhesives',
        name: 'چسب',
        children: [
          { key: 'chemicals.adhesives.tile', name: 'چسب کاشی' },
          { key: 'chemicals.adhesives.tape', name: 'چسب نواری' },
          { key: 'chemicals.adhesives.123', name: 'چسب ۱۲۳' },
          { key: 'chemicals.adhesives.sealing', name: 'چسب آب‌بندی' },
          { key: 'chemicals.adhesives.concrete', name: 'چسب بتن' },
          { key: 'chemicals.adhesives.stone', name: 'چسب سنگ' },
        ],
      },
      {
        key: 'chemicals.fuel',
        name: 'سوخت و انرژی',
        children: [
          { key: 'chemicals.fuel.coal', name: 'زغال' },
          { key: 'chemicals.fuel.petrochemical', name: 'محصولات پتروشیمی' },
          { key: 'chemicals.fuel.bitumen', name: 'قیر' },
          { key: 'chemicals.fuel.diesel', name: 'گازوئیل' },
          { key: 'chemicals.fuel.oil', name: 'روغن صنعتی' },
          { key: 'chemicals.fuel.paraffin', name: 'پارافین' },
          { key: 'chemicals.fuel.grease', name: 'گریس' },
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
          { key: 'automotive.vehicles.truck', name: 'کامیون و کشنده' },
          { key: 'automotive.vehicles.pickup', name: 'وانت و نیسان' },
          { key: 'automotive.vehicles.bus', name: 'اتوبوس و مینی‌بوس' },
          { key: 'automotive.vehicles.trailer', name: 'تریلر' },
        ],
      },
      {
        key: 'automotive.parts',
        name: 'قطعات و لوازم جانبی',
        children: [
          { key: 'automotive.parts.spare', name: 'لوازم یدکی' },
          { key: 'automotive.parts.engine', name: 'قطعات موتوری و گیربکس' },
          { key: 'automotive.parts.suspension', name: 'جلوبندی و تعلیق' },
          { key: 'automotive.parts.av', name: 'سیستم صوتی و روشنایی' },
          { key: 'automotive.parts.consumable', name: 'لوازم مصرفی' },
          { key: 'automotive.parts.decor', name: 'لوازم تزئینی' },
        ],
      },
      {
        key: 'automotive.tires',
        name: 'لاستیک خودرو',
        children: [
          { key: 'automotive.tires.car', name: 'لاستیک سواری' },
          { key: 'automotive.tires.truck', name: 'لاستیک کامیون' },
          { key: 'automotive.tires.bike', name: 'لاستیک دوچرخه' },
          { key: 'automotive.tires.moto', name: 'لاستیک موتور سیکلت' },
          { key: 'automotive.tires.loader', name: 'لاستیک لودر' },
          { key: 'automotive.tires.forklift', name: 'لاستیک لیفتراک' },
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
          { key: 'apparel.fabric.fabric', name: 'پارچه' },
          { key: 'apparel.fabric.yarn', name: 'نخ' },
          { key: 'apparel.fabric.cotton', name: 'پنبه' },
          { key: 'apparel.fabric.textile-trims', name: 'لوازم جانبی نساجی' },
          { key: 'apparel.fabric.apparel-trims', name: 'لوازم جانبی پوشاک' },
        ],
      },
      {
        key: 'apparel.clothing',
        name: 'پوشاک آماده',
        children: [
          { key: 'apparel.clothing.men', name: 'لباس مردانه' },
          { key: 'apparel.clothing.women', name: 'لباس زنانه' },
          { key: 'apparel.clothing.kids', name: 'لباس بچگانه' },
          { key: 'apparel.clothing.underwear', name: 'لباس زیر' },
          { key: 'apparel.clothing.sport', name: 'پوشاک ورزشی' },
          { key: 'apparel.clothing.corporate', name: 'لباس سازمانی' },
        ],
      },
      {
        key: 'apparel.leather',
        name: 'چرم',
        children: [
          { key: 'apparel.leather.natural', name: 'چرم طبیعی' },
          { key: 'apparel.leather.synthetic', name: 'چرم مصنوعی' },
          { key: 'apparel.leather.sole', name: 'زیره و کفی' },
        ],
      },
      {
        key: 'apparel.bags-shoes',
        name: 'کیف و کفش',
        children: [
          { key: 'apparel.bags-shoes.bag', name: 'کیف' },
          { key: 'apparel.bags-shoes.suitcase', name: 'چمدان' },
          { key: 'apparel.bags-shoes.backpack', name: 'کوله‌پشتی' },
          { key: 'apparel.bags-shoes.wallet', name: 'کیف پول' },
          { key: 'apparel.bags-shoes.sport-bag', name: 'ساک ورزشی' },
          { key: 'apparel.bags-shoes.cosmetic-bag', name: 'کیف آرایشی بهداشتی' },
          { key: 'apparel.bags-shoes.women', name: 'کفش زنانه' },
          { key: 'apparel.bags-shoes.men', name: 'کفش مردانه' },
          { key: 'apparel.bags-shoes.sport', name: 'کفش ورزشی' },
          { key: 'apparel.bags-shoes.kids', name: 'کفش بچگانه' },
        ],
      },
      {
        key: 'apparel.accessories',
        name: 'اکسسوری، ساعت و عینک',
        children: [
          { key: 'apparel.accessories.hair', name: 'اکسسوری مو' },
          { key: 'apparel.accessories.scarf', name: 'روسری و شال' },
          { key: 'apparel.accessories.hat', name: 'کلاه' },
          { key: 'apparel.accessories.glove', name: 'دستکش' },
          { key: 'apparel.accessories.belt', name: 'کمربند' },
          { key: 'apparel.accessories.watch', name: 'ساعت' },
          { key: 'apparel.accessories.glasses', name: 'عینک' },
          { key: 'apparel.accessories.jewelry', name: 'زیورآلات' },
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
          { key: 'home.appliances.fridge', name: 'یخچال' },
          { key: 'home.appliances.washer', name: 'لباسشویی' },
          { key: 'home.appliances.tv', name: 'تلویزیون' },
          { key: 'home.appliances.cooler', name: 'کولر' },
          { key: 'home.appliances.stove', name: 'اجاق گاز' },
          { key: 'home.appliances.hood', name: 'هود' },
          { key: 'home.appliances.heater', name: 'بخاری' },
          { key: 'home.appliances.boiler', name: 'آب گرمکن' },
          { key: 'home.appliances.vacuum', name: 'جاروبرقی' },
        ],
      },
      {
        key: 'home.digital',
        name: 'کالای دیجیتال',
        children: [
          { key: 'home.digital.mobile', name: 'موبایل' },
          { key: 'home.digital.laptop', name: 'لپ‌تاپ' },
          { key: 'home.digital.tablet', name: 'تبلت و کتابخوان' },
          { key: 'home.digital.pc', name: 'کامپیوتر و تجهیزات جانبی' },
          { key: 'home.digital.camera', name: 'دوربین' },
          { key: 'home.digital.mobile-acc', name: 'لوازم جانبی موبایل' },
          { key: 'home.digital.camera-acc', name: 'لوازم جانبی دوربین' },
          { key: 'home.digital.network', name: 'مودم و تجهیزات شبکه' },
          { key: 'home.digital.office', name: 'ماشین‌های اداری' },
        ],
      },
      {
        key: 'home.furniture',
        name: 'مبلمان و دکوراسیون',
        children: [
          { key: 'home.furniture.sofa', name: 'مبل' },
          { key: 'home.furniture.bedroom', name: 'سرویس خواب' },
          { key: 'home.furniture.chair', name: 'صندلی' },
          { key: 'home.furniture.table', name: 'میز' },
          { key: 'home.furniture.cabinet', name: 'کابینت' },
          { key: 'home.furniture.wardrobe', name: 'کمد' },
          { key: 'home.furniture.buffet', name: 'بوفه' },
          { key: 'home.furniture.carpet', name: 'فرش' },
          { key: 'home.furniture.curtain', name: 'پرده' },
          { key: 'home.furniture.wallpaper', name: 'کاغذ دیواری' },
          { key: 'home.furniture.flooring', name: 'کفپوش' },
          { key: 'home.furniture.wallcovering', name: 'دیوارپوش' },
          { key: 'home.furniture.shelf', name: 'شلف' },
        ],
      },
      {
        key: 'home.kitchen',
        name: 'آشپزخانه و ظروف',
        children: [
          { key: 'home.kitchen.tools', name: 'لوازم آشپزخانه' },
          { key: 'home.kitchen.cookware', name: 'ظروف پخت و پز' },
          { key: 'home.kitchen.serving', name: 'ظروف سرو و پذیرایی' },
          { key: 'home.kitchen.disposable', name: 'ظروف یکبار مصرف' },
          { key: 'home.kitchen.bath', name: 'لوازم حمام و سرویس بهداشتی' },
        ],
      },
      {
        key: 'home.cleaning',
        name: 'نظافت و شوینده',
        children: [
          { key: 'home.cleaning.detergent', name: 'مواد شوینده' },
          { key: 'home.cleaning.tissue', name: 'دستمال کاغذی' },
          { key: 'home.cleaning.wash', name: 'لوازم شستشو و نظافت' },
        ],
      },
      {
        key: 'home.pet',
        name: 'لوازم حیوانات خانگی',
        children: [{ key: 'home.pet.supplies', name: 'لوازم حیوانات خانگی' }],
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
          { key: 'health.cosmetics.skin', name: 'محصولات پوستی' },
          { key: 'health.cosmetics.hair', name: 'محصولات مو' },
          { key: 'health.cosmetics.hygiene', name: 'بهداشت شخصی' },
          { key: 'health.cosmetics.body', name: 'مراقبت و بهداشت بدن' },
          { key: 'health.cosmetics.perfume', name: 'عطر و ادکلن' },
        ],
      },
      {
        key: 'health.medical',
        name: 'تجهیزات پزشکی',
        children: [
          { key: 'health.medical.consumable', name: 'تجهیزات پزشکی مصرفی' },
          { key: 'health.medical.specialized', name: 'تجهیزات پزشکی تخصصی' },
          { key: 'health.medical.home', name: 'تجهیزات پزشکی خانگی' },
          { key: 'health.medical.orthopedic', name: 'تجهیزات ارتوپدی و حرکتی' },
        ],
      },
      {
        key: 'health.salon',
        name: 'تجهیزات آرایشگاهی',
        children: [{ key: 'health.salon.equipment', name: 'تجهیزات آرایشگاهی' }],
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
          { key: 'sports.sport.equipment', name: 'تجهیزات ورزشی' },
          { key: 'sports.sport.gym', name: 'تجهیزات بدنسازی' },
          { key: 'sports.sport.turf', name: 'چمن مصنوعی' },
          { key: 'sports.sport.flooring', name: 'کفپوش ورزشی' },
        ],
      },
      {
        key: 'sports.outdoor',
        name: 'کوهنوردی و کمپینگ',
        children: [{ key: 'sports.outdoor.outdoor', name: 'تجهیزات کوهنوردی و کمپینگ' }],
      },
      {
        key: 'sports.toys',
        name: 'اسباب‌بازی و بازی',
        children: [
          { key: 'sports.toys.toy', name: 'اسباب‌بازی' },
          { key: 'sports.toys.doll', name: 'عروسک' },
          { key: 'sports.toys.game', name: 'بازی و سرگرمی' },
          { key: 'sports.toys.party', name: 'لوازم مهمانی' },
        ],
      },
      {
        key: 'sports.baby',
        name: 'نوزاد و کودک',
        children: [
          { key: 'sports.baby.stroller', name: 'کالسکه' },
          { key: 'sports.baby.dish', name: 'ظروف نوزاد و کودک' },
        ],
      },
      {
        key: 'sports.music',
        name: 'ساز و استودیو',
        children: [
          { key: 'sports.music.guitar', name: 'گیتار' },
          { key: 'sports.music.piano', name: 'پیانو' },
          { key: 'sports.music.studio', name: 'تجهیزات استودیو' },
        ],
      },
      {
        key: 'sports.gifts',
        name: 'کادو و صنایع دستی',
        children: [
          { key: 'sports.gifts.wood', name: 'صنایع دستی چوبی' },
          { key: 'sports.gifts.metal', name: 'صنایع دستی فلزی' },
          { key: 'sports.gifts.weave', name: 'بافت' },
          { key: 'sports.gifts.textile', name: 'پارچه‌ای و چرمی' },
          { key: 'sports.gifts.gemstone', name: 'سنگ قیمتی' },
          { key: 'sports.gifts.hand-jewelry', name: 'زیورآلات دست‌ساز' },
          { key: 'sports.gifts.gift', name: 'لوازم کادویی' },
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
