/**
 * ─── تاکسونومی v2 — گروه‌بندی جدید ایمچ (۱۵ ریشه) ───────────────────────────
 *
 * تصمیم مالک (۱۶-۱۱): مهاجرت موازی با ایمپورت — سایت عمومی همچنان روی
 * دسته‌بندی باسکول کار می‌کند؛ این درخت فقط در «گزارش آگهی‌ها»ی ادمین
 * دیده می‌شود تا وقتی مالک تکمیل و سوییچ عمومی را اعلام کند.
 *
 * اصول (برگرفته از الگوی Alibaba/Made-in-China + بحث با مالک):
 *  • هر کالا فقط یک خانه دارد — بر اساس «چیستی کالا»، نه شغل فروشنده.
 *  • تفکیک فله/بسته‌بندی/صادراتی کار «فیلتر» است نه شاخهٔ دوم درخت.
 *  • مرزهای طلایی: زنده → دام؛ خوراکی مصرفی → غذایی؛ نهادهٔ تولید → نهاده‌ها.
 *  • خدمات B2B عمداً خارج از اسکوپ این فاز است (فازهای خیلی بعد).
 *
 * ساختار: کلیدهای سلسله‌مراتبی نقطه‌گذر («agri.pulses.chickpea») — زیردرخت
 * با پیشوند کلید قابل محاسبه است. L3 فقط برای شاخه‌های پایلوت تعریف شده
 * (حبوبات، خشکبار، تنقلات) — بقیه به‌تدریج با تأیید مالک عمیق می‌شوند.
 *
 * attrs (نوع کالا و ویژگی‌های فیلترپذیر): فعلاً فقط برای دو برگ پایلوت
 * (نخود و پفک — الگوی پروتوتایپ «تامینان») تعریف شده است. «match» آرایهٔ
 * نام‌های هم‌معنی است که با توکن‌های نام آگهی تطبیق داده می‌شود.
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
      { key: 'agri.fruit', name: 'میوه' },
      { key: 'agri.veg', name: 'صیفی و سبزی' },
      { key: 'agri.grains', name: 'غلات' },
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
                hint: 'مثل: نخود کابل، ممبلی (سیاه)، لک، سفید ریز',
                options: [
                  { label: 'کابل (سفید درشت)', match: ['کابل', 'سفید درشت'] },
                  { label: 'ممبلی (سیاه)', match: ['ممبلی', 'مصدری'] },
                  { label: 'لک', match: ['لک'] },
                  { label: 'سفید ریز', match: ['سفید ریز'] },
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
      { key: 'agri.spices', name: 'ادویه و گیاهان دارویی' },
      { key: 'agri.flowers', name: 'گل و گیاه' },
    ],
  },
  {
    key: 'livestock',
    name: 'دام، طیور و آبزیان زنده',
    icon: 'beef',
    children: [
      { key: 'livestock.live', name: 'دام و طیور زنده' },
      { key: 'livestock.aquatic', name: 'آبزیان زنده و بچه‌ماهی' },
    ],
  },
  {
    key: 'food',
    name: 'مواد غذایی و آشامیدنی',
    icon: 'utensils',
    children: [
      { key: 'food.beverages', name: 'نوشیدنی' },
      { key: 'food.protein', name: 'مواد پروتئینی' },
      { key: 'food.dairy', name: 'لبنیات' },
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
      { key: 'food.bakery', name: 'نان و ماکارونی' },
      { key: 'food.ingredients', name: 'مواد اولیه و چاشنی' },
      { key: 'food.canned', name: 'کنسرو و غذای آماده' },
      { key: 'food.honey', name: 'عسل و فرآورده‌های زنبور' },
    ],
  },
  {
    key: 'inputs',
    name: 'نهاده‌های کشاورزی و دامی',
    icon: 'shovel',
    children: [
      { key: 'inputs.fertilizer', name: 'کود' },
      { key: 'inputs.pesticide', name: 'سم و آفت‌کش' },
      { key: 'inputs.seed', name: 'بذر و نهال' },
      { key: 'inputs.feed', name: 'خوراک و علوفهٔ دام' },
      { key: 'inputs.supplies', name: 'پلاستیک و ملزومات کشاورزی' },
      { key: 'inputs.pet-food', name: 'خوراک حیوانات خانگی' },
    ],
  },
  {
    key: 'machinery',
    name: 'ماشین‌آلات و تجهیزات صنعتی',
    icon: 'cog',
    children: [
      { key: 'machinery.agri', name: 'ماشین‌آلات کشاورزی' },
      { key: 'machinery.food', name: 'تجهیزات صنایع غذایی' },
      { key: 'machinery.packaging', name: 'ماشین‌آلات بسته‌بندی و پرکن' },
      { key: 'machinery.printing', name: 'ماشین‌آلات چاپ' },
      { key: 'machinery.sewing', name: 'ماشین‌آلات دوخت و نساجی' },
      { key: 'machinery.workshop', name: 'ماشین‌آلات کارگاهی' },
      { key: 'machinery.construction', name: 'ماشین‌آلات راه، ساختمان و معدن' },
      { key: 'machinery.hvac', name: 'تهویه، سرمایش و گرمایش' },
      { key: 'machinery.cleaning', name: 'تجهیزات پاکسازی و تصفیه' },
      { key: 'machinery.energy', name: 'تجهیزات انرژی' },
      { key: 'machinery.handling', name: 'انبارداری و جابه‌جایی' },
    ],
  },
  {
    key: 'tools',
    name: 'ابزار، تأسیسات و قطعات فنی',
    icon: 'wrench',
    children: [
      { key: 'tools.hand', name: 'ابزار دستی و برقی' },
      { key: 'tools.welding', name: 'ابزار جوش و برش' },
      { key: 'tools.fittings', name: 'لوله، اتصالات و یراق' },
      { key: 'tools.pumps', name: 'پمپ و شیرآلات صنعتی' },
      { key: 'tools.electrical', name: 'برق و تأسیسات برقی' },
      { key: 'tools.automation', name: 'اتوماسیون و الکترونیک صنعتی' },
      { key: 'tools.safety', name: 'ایمنی و حفاظت کار' },
      { key: 'tools.lab', name: 'آزمایشگاهی و اندازه‌گیری' },
      { key: 'tools.surveillance', name: 'تجهیزات نظارتی' },
    ],
  },
  {
    key: 'packaging',
    name: 'کاغذ، چاپ و بسته‌بندی',
    icon: 'package',
    children: [
      { key: 'packaging.materials', name: 'کارتن، جعبه و ظروف بسته‌بندی' },
      { key: 'packaging.film', name: 'سلفون، نایلون و فیلم' },
      { key: 'packaging.print', name: 'خدمات چاپ و لیبل' },
      { key: 'packaging.stationery', name: 'نوشت‌افزار و ملزومات اداری' },
    ],
  },
  {
    key: 'construction',
    name: 'مصالح و تجهیزات ساختمان',
    icon: 'brick-wall',
    children: [
      { key: 'construction.materials', name: 'مصالح پایه' },
      { key: 'construction.stone', name: 'سنگ، کاشی و سرامیک' },
      { key: 'construction.wood', name: 'چوب' },
      { key: 'construction.openings', name: 'درب و پنجره' },
      { key: 'construction.insulation', name: 'عایق و نسوز' },
      { key: 'construction.mep', name: 'تأسیسات و روشنایی ساختمان' },
      { key: 'construction.equipment', name: 'تجهیزات ساختمانی' },
    ],
  },
  {
    key: 'metals',
    name: 'فلزات، آهن‌آلات و ضایعات',
    icon: 'anvil',
    children: [
      { key: 'metals.steel', name: 'آهن و فولاد' },
      { key: 'metals.stainless', name: 'استیل' },
      { key: 'metals.aluminum', name: 'آلومینیوم' },
      { key: 'metals.copper', name: 'مس، برنج و آلیاژها' },
      { key: 'metals.ore', name: 'کانی و کنسانترهٔ فلزی' },
      { key: 'metals.scrap', name: 'ضایعات و بازیافت' },
    ],
  },
  {
    key: 'chemicals',
    name: 'شیمیایی، پلیمر و انرژی',
    icon: 'flask',
    children: [
      { key: 'chemicals.paint', name: 'رنگ، رزین و پوشش' },
      { key: 'chemicals.industrial', name: 'مواد شیمیایی صنعتی' },
      { key: 'chemicals.minerals', name: 'کانی و مواد معدنی' },
      { key: 'chemicals.polymers', name: 'پلاستیک و پلیمر' },
      { key: 'chemicals.rubber', name: 'لاستیک صنعتی' },
      { key: 'chemicals.glass', name: 'شیشه' },
      { key: 'chemicals.adhesives', name: 'چسب' },
      { key: 'chemicals.fuel', name: 'سوخت و انرژی' },
    ],
  },
  {
    key: 'automotive',
    name: 'خودرو و حمل‌ونقل',
    icon: 'truck',
    children: [
      { key: 'automotive.vehicles', name: 'خودروهای تجاری و سنگین' },
      { key: 'automotive.parts', name: 'قطعات و لوازم جانبی' },
      { key: 'automotive.tires', name: 'لاستیک خودرو' },
    ],
  },
  {
    key: 'apparel',
    name: 'پوشاک، منسوجات و چرم',
    icon: 'shirt',
    children: [
      { key: 'apparel.fabric', name: 'پارچه، نخ و الیاف' },
      { key: 'apparel.clothing', name: 'پوشاک آماده' },
      { key: 'apparel.leather', name: 'چرم' },
      { key: 'apparel.bags-shoes', name: 'کیف و کفش' },
      { key: 'apparel.accessories', name: 'اکسسوری، ساعت و عینک' },
    ],
  },
  {
    key: 'home',
    name: 'خانه، مبلمان و لوازم برقی',
    icon: 'sofa',
    children: [
      { key: 'home.appliances', name: 'لوازم برقی خانگی' },
      { key: 'home.digital', name: 'کالای دیجیتال' },
      { key: 'home.furniture', name: 'مبلمان و دکوراسیون' },
      { key: 'home.kitchen', name: 'آشپزخانه و ظروف' },
      { key: 'home.cleaning', name: 'نظافت و شوینده' },
      { key: 'home.pet', name: 'لوازم حیوانات خانگی' },
    ],
  },
  {
    key: 'health',
    name: 'سلامت، زیبایی و پزشکی',
    icon: 'heart-pulse',
    children: [
      { key: 'health.cosmetics', name: 'آرایشی و بهداشتی' },
      { key: 'health.medical', name: 'تجهیزات پزشکی' },
      { key: 'health.salon', name: 'تجهیزات آرایشگاهی' },
    ],
  },
  {
    key: 'sports',
    name: 'ورزش، کودک و سرگرمی',
    icon: 'trophy',
    children: [
      { key: 'sports.sport', name: 'ورزش و بدنسازی' },
      { key: 'sports.outdoor', name: 'کوهنوردی و کمپینگ' },
      { key: 'sports.toys', name: 'اسباب‌بازی و بازی' },
      { key: 'sports.baby', name: 'نوزاد و کودک' },
      { key: 'sports.music', name: 'ساز و استودیو' },
      { key: 'sports.gifts', name: 'کادو و صنایع دستی' },
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
