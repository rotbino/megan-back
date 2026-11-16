/**
 * مولد نگاشت باسکول → تاکسونومی v2 — «جدول مهاجرت» به‌صورت کد.
 *
 *   bun scripts/gen-taxonomy-map.ts
 *
 * ورودی:  scripts/data/categories.json (درخت کامل ۶۹۵تایی باسکول — همان
 *         که seed پایه از آن ساخته می‌شود)
 * خروجی:  src/admin/ads-report/buskol-map.generated.ts
 *         (id باسکول → کلید v2 + نام باسکول → کلید v2 برای مقاومت در برابر
 *          دسته‌های آیندهٔ ایمپورت)
 *
 * قواعد به‌ترتیب اولویت:
 *   ۱) LEAF_OVERRIDES — استثناهای برگ (مثل: عسل → food.honey)
 *   ۲) L2_DEFAULTS    — پیش‌فرض هر زیرشاخهٔ باسکول
 *   ۳) L1_FALLBACK    — ریشهٔ باسکول (هرگز نباید فعال شود؛ فقط شبکهٔ ایمنی)
 *
 * پس از هر تغییر در تاکسونومی یا قواعد، دوباره اجرا شود — مولد اگر کلید
 * مقصدی در درخت v2 نباشد خطا می‌دهد (نگاشت معلق ممنوع).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenTaxonomy, validTaxonomyKeys } from '../src/admin/ads-report/taxonomy-v2';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cats: Array<{ id: number; parent_id: number | null; category_name: string }> = JSON.parse(
  readFileSync(join(__dirname, 'data', 'categories.json'), 'utf8'),
);

// ─── ۱) استثناهای برگ — «نام L2 باسکول / نام برگ» یا فقط «نام برگ» ──────────
// کلید '*': در هر L2 (برگ با نام یکتا مثل «عسل»)
const LEAF_OVERRIDES: Record<string, string> = {
  // ── کشاورزی › دامپروری — تقسیم سه‌گانه (زنده/خوراکی/نهاده) ──
  'دامپروری/عسل': 'food.honey',
  'دامپروری/خوراک دام': 'inputs.feed',
  'دامپروری/کاه': 'inputs.feed',
  'دامپروری/یونجه': 'inputs.feed',
  'دامپروری/دام و طیور زنده': 'livestock.live',
  // ── کشاورزی › بذر و نهال ──
  'بذر و نهال/نهال': 'inputs.seed',
  'بذر و نهال/بذر': 'inputs.seed',
  'بذر و نهال/گیاهان دارویی': 'agri.spices',
  'بذر و نهال/گل و گیاه': 'agri.flowers',
  // ── فلزات › مواد شیمیایی کشاورزی — خانهٔ واقعی نهاده‌ها ──
  'مواد شیمیایی کشاورزی/کود': 'inputs.fertilizer',
  // ── فلزات › مواد معدنی — فلزی به فلزات، نسوز/عایق به ساختمان ──
  'مواد معدنی/گندله آهن': 'metals.ore',
  'مواد معدنی/سنگ آهن': 'metals.ore',
  'مواد معدنی/سنگ مس': 'metals.ore',
  'مواد معدنی/سنگ سرب': 'metals.ore',
  'مواد معدنی/سنگ مگنتیت': 'metals.ore',
  'مواد معدنی/سنگ کروم': 'metals.ore',
  'مواد معدنی/سنگ مس اکسیدی': 'metals.ore',
  'مواد معدنی/سنگ منگنز': 'metals.ore',
  'مواد معدنی/سنگ کرومیت': 'metals.ore',
  'مواد معدنی/عایق حرارت': 'construction.insulation',
  'مواد معدنی/پشم سنگ': 'construction.insulation',
  'مواد معدنی/ورق نسوز': 'construction.insulation',
  // ── فلزات › مواد اولیه — شوینده/دارویی شیمیایی صنعتی، شیشه جداست ──
  'مواد اولیه/مواد اولیه شوینده': 'chemicals.industrial',
  'مواد اولیه/مواد اولیه دارویی': 'chemicals.industrial',
  'مواد اولیه/مواد اولیه شیشه': 'chemicals.glass',
  // ── فلزات › شیشه — پشم شیشه عایق، آزمایشگاهی ابزار ──
  'شیشه/پشم شیشه': 'construction.insulation',
  'شیشه/شیشه آزمایشگاهی': 'tools.lab',
  // ── فلزات › پلاستیک — بسته‌بندی/کشاورزی از پلیمر صنعتی جداست ──
  'پلاستیک/نایلون': 'packaging.film',
  'پلاستیک/سلفون': 'packaging.film',
  'پلاستیک/رول پلاستیک': 'packaging.film',
  'پلاستیک/بطری پلاستیکی': 'packaging.materials',
  'پلاستیک/پلاستیک بسته بندی': 'packaging.materials',
  'پلاستیک/پالت': 'packaging.materials',
  'پلاستیک/گونی': 'packaging.materials',
  'پلاستیک/پلاستیک کشاورزی': 'inputs.supplies',
  // ── فلزات › لاستیک — تایر خودروها به ریشهٔ خودرو ──
  'لاستیک/لاستیک سواری': 'automotive.tires',
  'لاستیک/لاستیک کامیون': 'automotive.tires',
  'لاستیک/لاستیک دوچرخه': 'automotive.tires',
  'لاستیک/لاستیک موتور سیکلت': 'automotive.tires',
  'لاستیک/لاستیک لودر': 'automotive.tires',
  'لاستیک/لاستیک لیفتراک': 'automotive.tires',
  // ── ماشین‌آلات › تجهیزات بسته‌بندی — متریال از ماشین جدا ──
  'تجهیزات بسته بندی/کارتن': 'packaging.materials',
  'تجهیزات بسته بندی/سبد': 'packaging.materials',
  'تجهیزات بسته بندی/بسته بندی پلاستیکی': 'packaging.materials',
  'تجهیزات بسته بندی/جعبه': 'packaging.materials',
  'تجهیزات بسته بندی/کاغذ': 'packaging.materials',
  'تجهیزات بسته بندی/بطری': 'packaging.materials',
  'تجهیزات بسته بندی/بشکه': 'packaging.materials',
  'تجهیزات بسته بندی/جامبو بگ': 'packaging.materials',
  'تجهیزات بسته بندی/بسته بندی فلزی': 'packaging.materials',
  // ── ماشین‌آلات › ابزارآلات — ارتقا به ریشهٔ ابزار ──
  'ابزارآلات/لوله و اتصالات': 'tools.fittings',
  'ابزارآلات/پمپ': 'tools.pumps',
  'ابزارآلات/ابزار جوش': 'tools.welding',
  'ابزارآلات/یراق آلات': 'tools.fittings',
  'ابزارآلات/شیرآلات صنعتی': 'tools.pumps',
  // ── غذا › تنقلات — L3 پایلوت (نام‌ها مستقیم روی برگ‌های باسکول) + نان ──
  'حبوبات/لوبیا': 'agri.pulses.beans',
  'حبوبات/نخود': 'agri.pulses.chickpea',
  'حبوبات/عدس': 'agri.pulses.lentil',
  'حبوبات/سویا': 'agri.pulses.soy',
  'حبوبات/لپه': 'agri.pulses.split',
  'خشکبار/میوه خشک': 'agri.nuts.dried-fruit',
  'خشکبار/پسته': 'agri.nuts.pistachio',
  'خشکبار/کشمش': 'agri.nuts.raisin',
  'خشکبار/بادام': 'agri.nuts.almond',
  'خشکبار/تخمه آفتابگردان': 'agri.nuts.sunflower',
  'خشکبار/گردو': 'agri.nuts.walnut',
  'خشکبار/زرشک': 'agri.nuts.barberry',
  'خشکبار/فندق': 'agri.nuts.hazelnut',
  'خشکبار/سبزی خشک': 'agri.nuts.dried-herbs',
  'تنقلات و شیرینی/پفک': 'food.snacks.puff',
  'تنقلات و شیرینی/چیپس': 'food.snacks.chips',
  'تنقلات و شیرینی/بیسکویت': 'food.snacks.biscuit',
  'تنقلات و شیرینی/شکلات': 'food.snacks.chocolate',
  'تنقلات و شیرینی/کیک و کلوچه': 'food.snacks.cake',
  'تنقلات و شیرینی/آدامس': 'food.snacks.gum',
  'تنقلات و شیرینی/پاستیل': 'food.snacks.pastille',
  'تنقلات و شیرینی/لواشک': 'food.snacks.lavashak',
  'تنقلات و شیرینی/نبات': 'food.snacks.nabat',
  'تنقلات و شیرینی/نان': 'food.bakery',
  'کنسانتره و کنسرو/ماکارونی': 'food.bakery',
  // ── خانه و مصالح › مصالح — سنگ/کاشی/چوب/عایق خودشان L2 دارند ──
  'مصالح ساختمانی/سنگ ساختمانی': 'construction.stone',
  'مصالح ساختمانی/کاشی و سرامیک': 'construction.stone',
  'مصالح ساختمانی/چوب': 'construction.wood',
  'مصالح ساختمانی/عایق': 'construction.insulation',
  // ── خانه و مصالح › تجهیزات ساختمانی ──
  'تجهیزات ساختمانی/درب و پنجره': 'construction.openings',
  'تجهیزات ساختمانی/شیرآلات': 'construction.mep',
  'تجهیزات ساختمانی/روشویی و دستشویی': 'construction.mep',
  'تجهیزات ساختمانی/سینک': 'construction.mep',
  'تجهیزات ساختمانی/سیفون': 'construction.mep',
  // ── خانه و مصالح › تجهیزات خانه — نظافت/پت/عمومی جدا ──
  'تجهیزات خانه و آشپزخانه/مواد شوینده': 'home.cleaning',
  'تجهیزات خانه و آشپزخانه/دستمال کاغذی': 'home.cleaning',
  'تجهیزات خانه و آشپزخانه/لوازم شستشو و نظافت': 'home.cleaning',
  'تجهیزات خانه و آشپزخانه/لوازم حیوانات خانگی': 'home.pet',
  'تجهیزات خانه و آشپزخانه/سایر تجهیزات خانه': 'home.appliances',
  // ── لوازم خانگی › دیجیتال — نظارتی تجاری به ابزار، ساز به سرگرمی ──
  'کالای دیجیتال/تجهیزات نظارتی': 'tools.surveillance',
  // ── مد پوشاک — چرم و اکسسوری خودشان L2 دارند ──
  'نساجی، پارچه و چرم/چرم': 'apparel.leather',
  // ── ورزشی — کوهنوردی L2 خودش ──
  'لوازم ورزشی/تجهیزات کوهنوردی و کمپینگ': 'sports.outdoor',
  // ── آرایشی — تجهیزات آرایشگاهی L2 خودش ──
  'آرایشی و بهداشتی/تجهیزات آرایشگاهی': 'health.salon',
};

// ─── ۲) پیش‌فرض هر L2 باسکول — «نام ریشه / نام L2» ──────────────────────────
const L2_DEFAULTS: Record<string, string> = {
  // کشاورزی
  'کشاورزی/خشکبار': 'agri.nuts',
  'کشاورزی/میوه': 'agri.fruit',
  'کشاورزی/صیفی': 'agri.veg',
  'کشاورزی/غلات': 'agri.grains',
  'کشاورزی/ادویه': 'agri.spices',
  'کشاورزی/حبوبات': 'agri.pulses',
  // L2 های دامپروری/بذر — برگ‌هایشان استثنای صریح دارند؛ خودشان نزدیک‌ترین خانه:
  'کشاورزی/دامپروری': 'livestock.live',
  'کشاورزی/بذر و نهال': 'inputs.seed',
  // غذایی
  'فرآورده های غذایی/نوشیدنی': 'food.beverages',
  'فرآورده های غذایی/مواد پروتئینی': 'food.protein',
  'فرآورده های غذایی/تنقلات و شیرینی': 'food.snacks',
  'فرآورده های غذایی/کنسانتره و کنسرو': 'food.canned',
  'فرآورده های غذایی/چاشنی و افزودنی': 'food.ingredients',
  'فرآورده های غذایی/لبنیات': 'food.dairy',
  // فلزات
  'فلزات، مواد معدنی و شیمیایی/مواد شیمیایی کشاورزی': 'inputs.pesticide',
  'فلزات، مواد معدنی و شیمیایی/آلومینیوم': 'metals.aluminum',
  'فلزات، مواد معدنی و شیمیایی/آهن': 'metals.steel',
  'فلزات، مواد معدنی و شیمیایی/فلزات آلیاژی': 'metals.stainless',
  'فلزات، مواد معدنی و شیمیایی/ضایعات': 'metals.scrap',
  'فلزات، مواد معدنی و شیمیایی/رنگ و پوشش': 'chemicals.paint',
  'فلزات، مواد معدنی و شیمیایی/مواد شیمیایی': 'chemicals.industrial',
  'فلزات، مواد معدنی و شیمیایی/مواد معدنی': 'chemicals.minerals',
  'فلزات، مواد معدنی و شیمیایی/مواد اولیه': 'chemicals.polymers',
  'فلزات، مواد معدنی و شیمیایی/شیشه': 'chemicals.glass',
  'فلزات، مواد معدنی و شیمیایی/پلاستیک': 'chemicals.polymers',
  'فلزات، مواد معدنی و شیمیایی/لاستیک': 'chemicals.rubber',
  'فلزات، مواد معدنی و شیمیایی/سوخت و انرژی': 'chemicals.fuel',
  'فلزات، مواد معدنی و شیمیایی/چسب': 'chemicals.adhesives',
  // ماشین‌آلات
  'ماشین آلات و تجهیزات صنعتی/تجهیزات بسته بندی': 'machinery.packaging',
  'ماشین آلات و تجهیزات صنعتی/تجهیزات کشاورزی': 'machinery.agri',
  'ماشین آلات و تجهیزات صنعتی/تجهیزات صنایع غذایی': 'machinery.food',
  'ماشین آلات و تجهیزات صنعتی/تجهیزات چاپ': 'machinery.printing',
  'ماشین آلات و تجهیزات صنعتی/تجهیزات سرمایش و گرمایش': 'machinery.hvac',
  'ماشین آلات و تجهیزات صنعتی/تجهیزات راه و ساختمان': 'machinery.construction',
  'ماشین آلات و تجهیزات صنعتی/تجهیزات پاکسازی': 'machinery.cleaning',
  'ماشین آلات و تجهیزات صنعتی/تجهیزات انرژی': 'machinery.energy',
  'ماشین آلات و تجهیزات صنعتی/تجهیزات صنعتی': 'machinery.workshop',
  'ماشین آلات و تجهیزات صنعتی/تجهیزات دوخت و نساجی': 'machinery.sewing',
  'ماشین آلات و تجهیزات صنعتی/ابزارآلات': 'tools.hand',
  'ماشین آلات و تجهیزات صنعتی/تجهیزات الکتریکی': 'tools.electrical',
  'ماشین آلات و تجهیزات صنعتی/لوازم یدکی و جانبی': 'automotive.parts',
  // خانه و مصالح
  'خانه و مصالح ساختمانی/مصالح ساختمانی': 'construction.materials',
  'خانه و مصالح ساختمانی/تجهیزات ساختمانی': 'construction.equipment',
  'خانه و مصالح ساختمانی/تجهیزات روشنایی': 'construction.mep',
  'خانه و مصالح ساختمانی/مبلمان و دکوراسیون': 'home.furniture',
  'خانه و مصالح ساختمانی/تجهیزات خانه و آشپزخانه': 'home.kitchen',
  'خانه و مصالح ساختمانی/نوشت ابزار': 'packaging.stationery',
  // لوازم خانگی
  'لوازم خانگی و الکترونیکی/لوازم خانگی': 'home.appliances',
  'لوازم خانگی و الکترونیکی/کالای دیجیتال': 'home.digital',
  'لوازم خانگی و الکترونیکی/ساز و تجهیزات استودیویی': 'sports.music',
  // مد پوشاک
  'مد، پوشاک و پارچه/پوشاک': 'apparel.clothing',
  'مد، پوشاک و پارچه/نساجی، پارچه و چرم': 'apparel.fabric',
  'مد، پوشاک و پارچه/اکسسوری و مد': 'apparel.accessories',
  'مد، پوشاک و پارچه/ساعت، زیورآلات و عینک': 'apparel.accessories',
  // کیف و کفش
  'کیف و کفش/کیف و چمدان': 'apparel.bags-shoes',
  'کیف و کفش/کفش': 'apparel.bags-shoes',
  // ورزشی
  'لوازم ورزشی، کادویی و اسباب بازی/لوازم ورزشی': 'sports.sport',
  'لوازم ورزشی، کادویی و اسباب بازی/کادویی و صنایع دستی': 'sports.gifts',
  'لوازم ورزشی، کادویی و اسباب بازی/اسباب بازی و سرگرمی': 'sports.toys',
  'لوازم ورزشی، کادویی و اسباب بازی/لوازم نوزاد و کودک': 'sports.baby',
  // آرایشی
  'آرایشی، بهداشتی و سلامت/آرایشی و بهداشتی': 'health.cosmetics',
  'آرایشی، بهداشتی و سلامت/تجهیزات پزشکی': 'health.medical',
};

// ─── ۳) شبکهٔ ایمنی — هرگز نباید فعال شود ────────────────────────────────────
const L1_FALLBACK: Record<string, string> = {
  'کشاورزی': 'agri',
  'فرآورده های غذایی': 'food',
  'فلزات، مواد معدنی و شیمیایی': 'metals',
  'ماشین آلات و تجهیزات صنعتی': 'machinery',
  'خانه و مصالح ساختمانی': 'construction',
  'لوازم خانگی و الکترونیکی': 'home',
  'مد، پوشاک و پارچه': 'apparel',
  'کیف و کفش': 'apparel.bags-shoes',
  'لوازم ورزشی، کادویی و اسباب بازی': 'sports',
  'آرایشی، بهداشتی و سلامت': 'health',
};

// ─── اجرا ─────────────────────────────────────────────────────────────────────

const byId = new Map(cats.map((c) => [c.id, c]));
const nameOf = (id: number | null): string =>
  id == null ? '' : (byId.get(id)?.category_name ?? '').trim();

const validKeys = validTaxonomyKeys();
const idMap = new Map<number, string>();
const nameMap = new Map<string, string>();
const problems: string[] = [];
let fallbackUsed = 0;

for (const c of cats) {
  const leaf = (c.category_name ?? '').trim();
  const parent = c.parent_id != null ? byId.get(c.parent_id) : undefined;
  const isRoot = parent == null;
  const parentIsRoot = parent != null && parent.parent_id == null;

  // مسیر سطح‌دار: ریشه / L2 / برگ (برای قواعد)
  let root = '';
  let l2 = '';
  if (isRoot) root = leaf;
  else if (parentIsRoot) {
    root = parent!.category_name.trim();
    l2 = leaf;
  } else {
    l2 = parent!.category_name.trim();
    root = nameOf(parent!.parent_id);
  }

  let target: string | undefined;
  if (isRoot) {
    // خود ریشه — فقط شبکهٔ ایمنی
    target = L1_FALLBACK[leaf];
  } else if (parentIsRoot) {
    // خودش L2 است
    target = L2_DEFAULTS[`${root}/${leaf}`] ?? L1_FALLBACK[root];
  } else {
    // برگ L3+ — استثنا ← پیش‌فرض L2 ← شبکهٔ ایمنی ریشه
    target =
      LEAF_OVERRIDES[`${l2}/${leaf}`] ??
      LEAF_OVERRIDES[`${l2}/*`] ??
      L2_DEFAULTS[`${root}/${l2}`] ??
      L1_FALLBACK[root];
    // فقط وقتی «واقعاً» روی ریشه افتاد (کلید بدون نقطه) بشماریم
    if (target && !target.includes('.')) fallbackUsed++;
  }
  if (!target) {
    problems.push(`بدون مقصد: ${root}/${l2}/${leaf} (id=${c.id})`);
    continue;
  }
  if (!validKeys.has(target)) {
    problems.push(`مقصد نامعتبر «${target}» برای: ${root}/${l2}/${leaf} (id=${c.id})`);
    continue;
  }
  idMap.set(c.id, target);
  // نام یکتا → نگاشت (برای دسته‌های آینده با همان نام)
  if (!nameMap.has(leaf)) nameMap.set(leaf, target);
}

if (problems.length) {
  console.error(`✖ ${problems.length} مشکل:\n` + problems.slice(0, 20).join('\n'));
  process.exit(1);
}

// ─── خروجی ────────────────────────────────────────────────────────────────────
const sortedIds = [...idMap.entries()].sort((a, b) => a[0] - b[0]);
const sortedNames = [...nameMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fa'));

const ts = `// ⚠️ تولیدشده توسط scripts/gen-taxonomy-map.ts — دست‌نویسی ممنوع.
// بازتولید: bun scripts/gen-taxonomy-map.ts
// منبع: scripts/data/categories.json (درخت باسکول) + قواعد مهاجرت v2.
// پوشش: ${idMap.size} از ${cats.length} دستهٔ باسکول؛ شبکهٔ ایمنی L1: ${fallbackUsed} مورد.

/** id دستهٔ باسکول → کلید تاکسونومی v2 (کوچک‌ترین واحد مهاجرت آگهی‌ها) */
export const BUSKOL_TO_V2: Readonly<Record<number, string>> = {
${sortedIds.map(([id, key]) => `  ${id}: '${key}',`).join('\n')}
};

/** نام دستهٔ باسکول → کلید v2 — مقاومت در برابر دسته‌های تازهٔ ایمپورت */
export const BUSKOL_NAME_TO_V2: Readonly<Record<string, string>> = {
${sortedNames.map(([name, key]) => `  '${name.replace(/'/g, "\\'")}': '${key}',`).join('\n')}
};
`;

writeFileSync(join(__dirname, '..', 'src', 'admin', 'ads-report', 'buskol-map.generated.ts'), ts);

// ─── آمار ─────────────────────────────────────────────────────────────────────
const perRoot = new Map<string, number>();
for (const [, key] of idMap) {
  const root = key.split('.')[0];
  perRoot.set(root, (perRoot.get(root) ?? 0) + 1);
}
console.log(`✅ ${idMap.size}/${cats.length} دسته نگاشت شد (fallback ریشه: ${fallbackUsed})`);
console.log('توزیع مقصد بر اساس ریشهٔ v2:');
for (const [root, count] of [...perRoot.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${root.padEnd(12)} ${count}`);
}
