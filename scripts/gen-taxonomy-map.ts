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
 *   ۲) AUTO_NAME      — تطبیق خودکار نام برگ با گره‌های عمیق v2 (سطح ۳+،
 *                      نام یکتا پس از نرمال‌سازی فارسی) — قاعدهٔ اصلی عمق
 *   ۳) L2_DEFAULTS    — پیش‌فرض هر زیرشاخهٔ باسکول
 *   ۴) L1_FALLBACK    — ریشهٔ باسکول (هرگز نباید فعال شود؛ فقط شبکهٔ ایمنی)
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

// ─── ۱) استثناهای برگ — «نام L2 باسکول / نام برگ» ──────────────────────────
// فقط مواردی که تطبیق خودکار نام (AUTO_NAME) نمی‌تواند مقصد درست را پیدا کند:
// نام مقصد با نام باسکول فرق دارد یا مقصد خارج از شاخهٔ طبیعی است.
const LEAF_OVERRIDES: Record<string, string> = {
  // ── کشاورزی › دامپروری — تقسیم سه‌گانه (زنده/خوراکی/نهاده) ──
  'دامپروری/عسل': 'food.honey',
  'دامپروری/دام و طیور زنده': 'livestock.live',
  // ── کشاورزی › بذر و نهال ──
  'بذر و نهال/گل و گیاه': 'agri.flowers',
  // ── فلزات › مواد شیمیایی کشاورزی — خانهٔ واقعی نهاده‌ها ──
  'مواد شیمیایی کشاورزی/کود': 'inputs.fertilizer',
  'مواد شیمیایی کشاورزی/هورمون کشاورزی': 'inputs.pesticide.hormone',
  // ── فلزات › مواد معدنی — مسیرهای خاص ──
  'مواد معدنی/سنگ مس اکسیدی': 'metals.ore.copper',
  // ── فلزات › مواد اولیه — شوینده/دارویی شیمیایی صنعتی، شیشه جداست ──
  'مواد اولیه/مواد اولیه شوینده': 'chemicals.industrial',
  'مواد اولیه/مواد اولیه دارویی': 'chemicals.industrial',
  'مواد اولیه/مواد اولیه شیشه': 'chemicals.glass',
  // ── غذا › نوشیدنی — گلاب کنار عرقیات ──
  'نوشیدنی/گلاب': 'food.beverages.herbals',
  // ── غذا › کنسرو — نام‌های کوتاه باسکول روی مقصد گویاتر ──
  'کنسانتره و کنسرو/رب': 'food.canned.tomato-paste',
  'کنسانتره و کنسرو/کنسانتره': 'food.canned.concentrate',
  // ── خانه و مصالح › مصالح — چوب فقط L2 خودش را دارد (فرزندان خاص‌ترند) ──
  'مصالح ساختمانی/چوب': 'construction.wood',
  // ── خانه و مصالح › تجهیزات خانه — عمومی‌ها ──
  'تجهیزات خانه و آشپزخانه/سایر تجهیزات خانه': 'home.appliances',
  // ── لوازم خانگی › دیجیتال — نظارتی تجاری به ابزار ──
  'کالای دیجیتال/تجهیزات نظارتی': 'tools.surveillance',
  // ── مد پوشاک — چرم خارج از شاخهٔ پارچه ──
  'نساجی، پارچه و چرم/چرم': 'apparel.leather',
};

// ─── ۱٫۵) تطبیق خودکار نام — قاعدهٔ اصلی عمق ───────────────────────────────
// ایندکس نام‌های یکتای همهٔ گره‌های عمیق v2 (سطح ۳ به بعد، زیر L2) پس از
// نرمال‌سازی فارسی. برگ باسکول که نامش دقیقاً با یک گرهٔ عمیق یکتا یکی
// باشد، همان‌جا می‌نشیند — سیب→agri.fruit.apple، تن ماهی→food.canned.tuna.
// نام تکراری بین دو شاخه → از ایندکس حذف (برگ به L2 خودش برمی‌گردد).
const normalizeName = (s: string): string =>
  (s ?? '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const deepByName = new Map<string, string>();
const duplicateNames = new Set<string>();
for (const n of flattenTaxonomy()) {
  if (n.level < 3) continue;
  const k = normalizeName(n.name);
  if (!k) continue;
  if (deepByName.has(k)) duplicateNames.add(k);
  else deepByName.set(k, n.key);
}
for (const d of duplicateNames) deepByName.delete(d);

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
let autoMatched = 0;

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
    // برگ L3+ — استثنا ← تطبیق خودکار نام عمیق ← پیش‌فرض L2 ← شبکهٔ ایمنی ریشه
    const autoKey = deepByName.get(normalizeName(leaf));
    target =
      LEAF_OVERRIDES[`${l2}/${leaf}`] ??
      LEAF_OVERRIDES[`${l2}/*`] ??
      autoKey ??
      L2_DEFAULTS[`${root}/${l2}`] ??
      L1_FALLBACK[root];
    // فقط وقتی «واقعاً» روی ریشه افتاد (کلید بدون نقطه) بشماریم
    if (target && !target.includes('.')) fallbackUsed++;
    if (autoKey) autoMatched++;
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
// پوشش: ${idMap.size} از ${cats.length} دستهٔ باسکول؛ تطبیق خودکار نام عمیق: ${autoMatched}؛ شبکهٔ ایمنی L1: ${fallbackUsed} مورد.

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
console.log(`✅ ${idMap.size}/${cats.length} دسته نگاشت شد (تطبیق خودکار عمیق: ${autoMatched}، fallback ریشه: ${fallbackUsed})`);
console.log(`گره‌های عمیق یکتا در ایندکس نام: ${deepByName.size}${duplicateNames.size ? ` (${duplicateNames.size} نام تکراری نادیده: ${[...duplicateNames].slice(0, 5).join('، ')})` : ''}`);
console.log('توزیع مقصد بر اساس ریشهٔ v2:');
for (const [root, count] of [...perRoot.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${root.padEnd(12)} ${count}`);
}
