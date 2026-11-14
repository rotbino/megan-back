/**
 * تبدیل توضیحات HTML-مانند باسکول به متن سادهٔ چندخطی (خواستهٔ مالک ۱۴-۱۱:
 * «تگ <hr/> در توضیحات دیده می‌شود؛ باید خط بعدی بیفتد»).
 *
 * باسکول خطوط توضیح آگهی را با <hr/> جدا می‌کند (۱۰۱۳ مورد در ۱۶۲ آگهی،
 * پیمایش ۱۴-۱۱ — تنها تگِ موجود در داده). این تابع آن و خواهرانش را به
 * خطِ نو (\n) تبدیل می‌کند تا با whitespace-pre-line فرانت درست نمایش داده
 * شود؛ بقیهٔ تگ‌ها حذف و موجودیت‌های HTML دیکد می‌شوند.
 *
 * idempotent است — متنِ پاک دوباره تغییری نمی‌کند (backfill/ایمپورت دوباره امن).
 */

/** موجودیت‌های نامی که در متن فارسی باسکول واقعاً دیده می‌شود */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  zwnj: '\u200c',
  lrm: '\u200e',
  rlm: '\u200f',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  laquo: '«',
  raquo: '»',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
  bull: '•',
};

/** تگ‌هایی که «شروع خط نو» معنی می‌دهند — hr/br و باز/بستنِ بلوک‌ها */
const LINE_BREAK_TAG =
  /<(?:hr|br)\b[^>]*>|<\/?(?:p|div|li|ul|ol|h[1-6]|tr|table|blockquote)\b[^>]*>/gi;

/** دیکد موجودیت‌های HTML — amp عمداً آخر تا &amp;lt; به < تبدیل نشود */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z#0-9]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/**
 * متن سادهٔ چندخطی: جداکننده‌ها → \n، بقیهٔ تگ‌ها حذف، موجودیت‌ها دیکد،
 * فاصله‌های ته‌کشیده سطرها چیده و \nهای اضافی فشرده می‌شوند.
 */
export function descToText(input: string | null | undefined): string {
  let t = String(input ?? '');
  if (!t.includes('<') && !t.includes('&')) return t.trim();
  t = t
    .replace(/\r\n?/g, '\n')
    .replace(LINE_BREAK_TAG, '\n')
    .replace(/<[^>]*>/g, '');
  t = decodeEntities(t);
  return t
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
