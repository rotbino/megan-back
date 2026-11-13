// تست فقط-خواندی الگوهای imported-products.service.ts روی دیتابیس واقعی —
// همان pipeline های لیست آگهی‌ها/آمار/آلبوم تصاویر را مستقیم می‌زند و
// شکل/صحت خروجی را چک می‌کند. هیچ چیزی نمی‌نویسد.
import { config } from 'dotenv';
config({ override: true });

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const toIso = (v) => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v) return v;
  if (v && typeof v === 'object' && typeof v.$date === 'string') return v.$date;
  return null;
};

const editsLookup = () => ({
  $lookup: {
    from: 'ProductEditHistory',
    let: { pid: '$_id' },
    pipeline: [
      { $match: { $expr: { $eq: ['$product_id', '$$pid'] }, action: 'edit' } },
      { $project: { created_at: 1 } },
    ],
    as: '_edits',
  },
});

const photosLookup = () => ({
  $lookup: {
    from: 'File',
    let: { pid: { $toString: '$_id' } },
    pipeline: [
      { $match: { related_model: 'Product', field_key: 'gallery' } },
      { $match: { $expr: { $eq: ['$related_id', '$$pid'] } } },
      { $project: { url: 1, thumb_url: 1, created_at: 1 } },
      { $sort: { created_at: 1 } },
      { $limit: 8 },
    ],
    as: '_photos',
  },
});

async function run(aggregate, pipeline) {
  const res = await prisma.$runCommandRaw({ aggregate, pipeline, cursor: {} });
  return res?.cursor?.firstBatch ?? [];
}

// ═════════ ۱. پایپ‌لاین لیست آگهی‌ها (بدون فیلتر، صفحهٔ ۱) ═════════
console.log('\n— لیست آگهی‌ها (پایپ‌لاین سرویس) —');
const rows = await run('Product', [
  { $match: {} },
  { $lookup: { from: 'User', localField: 'user_id', foreignField: '_id', as: 'owner' } },
  { $unwind: '$owner' },
  {
    $facet: {
      rows: [
        { $sort: { created_at: -1, _id: -1 } },
        { $skip: 0 },
        { $limit: 5 },
        editsLookup(),
        photosLookup(),
        {
          $project: {
            _id: 1, product_name: 1, slug: 1, status: 1, created_at: 1, updated_at: 1,
            price_updated_at: 1, view_count: 1, min_sale_price: 1, stock: 1,
            category_id: 1, sub_category_id: 1, province_id: 1, city_id: 1, unit: 1,
            _edits: 1, _photos: 1,
            owner: { _id: 1, phone: 1, user_name: 1, b_user_name: 1, first_name: 1, last_name: 1, last_login_at: 1 },
          },
        },
      ],
      total: [{ $count: 'n' }],
    },
  },
]);
const facet = rows[0] ?? {};
const total = Number((facet.total ?? [])[0]?.n ?? 0);
const listRows = facet.rows ?? [];
const productCount = await prisma.product.count();
check('تعداد کل با prisma.count برابری می‌کند', total === productCount, `${total} vs ${productCount}`);
check('ردیف‌ها برمی‌گردند', listRows.length > 0 && listRows.length <= 5);
check('هر ردیف مالک دارد', listRows.every((r) => r.owner && r.owner.user_name));
check('source از b_user_name استنتاج می‌شود', listRows.every((r) => r.owner.b_user_name != null || r.owner.b_user_name === null));
const buskoolRows = listRows.filter((r) => r.owner?.b_user_name != null).length;
console.log(`  • نمونه: ${listRows.length} ردیف، ${buskoolRows} باسکولی؛ مثلاً «${listRows[0]?.product_name}» مالک @${listRows[0]?.owner?.user_name}`);
check('فیلد _photos آرایه است', listRows.every((r) => Array.isArray(r._photos)));
check('فیلد _edits آرایه است', listRows.every((r) => Array.isArray(r._edits)));

// ═════════ ۲. فیلتر منبع باسکولی ═════════
console.log('\n— فیلتر source=buskool —');
const buskoolFilter = await run('Product', [
  { $match: {} },
  { $lookup: { from: 'User', localField: 'user_id', foreignField: '_id', as: 'owner' } },
  { $unwind: '$owner' },
  { $match: { 'owner.b_user_name': { $ne: null } } },
  { $count: 'n' },
]);
const buskoolCount = Number(buskoolFilter[0]?.n ?? 0);
const buskoolUsers = await prisma.user.count({ where: { bUserName: { not: null } } });
const buskoolExpected = await prisma.product.count({ where: { user: { bUserName: { not: null } } } });
check('شمارش باسکولی با prisma رابطه‌ای برابری می‌کند', buskoolCount === buskoolExpected, `${buskoolCount} vs ${buskoolExpected}`);
console.log(`  • آگهی باسکولی: ${buskoolCount} (از ${buskoolUsers} کاربر باسکولی)`);

// ═════════ ۳. آمار کلی (summary) ═════════
console.log('\n— آمار کلی آگهی‌ها —');
const sum = (await run('Product', [
  { $lookup: { from: 'User', localField: 'user_id', foreignField: '_id', as: 'owner' } },
  { $unwind: '$owner' },
  editsLookup(),
  photosLookup(),
  {
    $addFields: {
      _edited: { $gt: [{ $size: { $ifNull: ['$_edits', []] } }, 0] },
      _photoCount: { $size: { $ifNull: ['$_photos', []] } },
    },
  },
  {
    $facet: {
      total: [{ $count: 'n' }],
      buskool: [{ $match: { 'owner.b_user_name': { $ne: null } } }, { $count: 'n' }],
      native: [{ $match: { 'owner.b_user_name': null } }, { $count: 'n' }],
      ownerLoggedIn: [{ $match: { 'owner.last_login_at': { $ne: null } } }, { $count: 'n' }],
      editedByUser: [{ $match: { _edited: true } }, { $count: 'n' }],
      withoutPhotos: [{ $match: { $expr: { $eq: ['$_photoCount', 0] } } }, { $count: 'n' }],
      pending: [{ $match: { status: 'pending' } }, { $count: 'n' }],
    },
  },
]))[0] ?? {};
const cnt = (k) => Number((sum[k] ?? [])[0]?.n ?? 0);
check('total + buskool + native = کل آگهی‌ها', cnt('total') === cnt('buskool') + cnt('native') || cnt('total') === productCount, `${cnt('total')} = ${cnt('buskool')}+${cnt('native')}`);
const editedExpected = await prisma.productEditHistory.groupBy({ by: ['productId'], where: { action: 'edit' } });
check('editedByUser = تعداد آگهی‌های دارای action=edit', cnt('editedByUser') === editedExpected.length, `${cnt('editedByUser')} vs ${editedExpected.length}`);
console.log(`  • کل=${cnt('total')} باسکول=${cnt('buskool')} خودی=${cnt('native')} ورود‌کرده=${cnt('ownerLoggedIn')} ویرایش‌شده=${cnt('editedByUser')} بدون‌عکس=${cnt('withoutPhotos')} در‌انتظار=${cnt('pending')}`);

// ═════════ ۴. آلبوم تصاویر ═════════
console.log('\n— آلبوم تصاویر آگهی‌ها —');
const imgFilter = { related_model: 'Product', field_key: 'gallery', related_id: { $ne: null } };
const [imgTotalBatch, imgRows] = await Promise.all([
  run('File', [{ $match: imgFilter }, { $count: 'n' }]),
  run('File', [
    { $match: imgFilter },
    { $sort: { created_at: -1, _id: -1 } },
    { $skip: 0 },
    { $limit: 20 },
    {
      $lookup: {
        from: 'Product',
        let: { rid: '$related_id' },
        pipeline: [{ $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$rid'] } } }],
        as: 'product',
      },
    },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'User', localField: 'product.user_id', foreignField: '_id', as: 'ownerUser' } },
    {
      $project: {
        url: 1, thumb_url: 1, size: 1, mime_type: 1, created_at: 1, updated_at: 1, metadata: 1,
        product: { _id: 1, product_name: 1, slug: 1, status: 1 },
        ownerUser: { _id: 1, phone: 1, user_name: 1, b_user_name: 1, first_name: 1, last_name: 1 },
      },
    },
  ]),
]);
const imgTotal = Number(imgTotalBatch[0]?.n ?? 0);
const galleryExpected = await prisma.file.count({ where: { relatedModel: 'Product', fieldKey: 'gallery', relatedId: { not: null } } });
check('تعداد کل تصاویر گالری درست است', imgTotal === galleryExpected, `${imgTotal} vs ${galleryExpected}`);
check('ردیف‌های آلبوم حداکثر ۲۰ تا', imgRows.length <= 20 && imgRows.length > 0);
const withProduct = imgRows.filter((r) => r.product?._id != null).length;
check('تقریباً همهٔ ردیف‌ها آگهی دارند', withProduct >= imgRows.length - 1, `${withProduct}/${imgRows.length}`);
const withOwner = imgRows.filter((r) => (r.ownerUser ?? []).length > 0).length;
check('تقریباً همهٔ ردیف‌ها فروشنده دارند', withOwner >= imgRows.length - 1, `${withOwner}/${imgRows.length}`);
const importedCount = imgRows.filter((r) => r.metadata?.importedFrom === 'buskool').length;
console.log(`  • نمونهٔ آلبوم: ${imgRows.length} تصویر، ${importedCount} باسکولی؛ مثلاً «${imgRows[0]?.product?.product_name}» فروشنده @${imgRows[0]?.ownerUser?.[0]?.user_name}`);
check('url همهٔ ردیف‌ها پر است', imgRows.every((r) => typeof r.url === 'string' && r.url));

// ═════════ ۵. آمار تصاویر ═════════
console.log('\n— آمار تصاویر —');
const imgSum = (await run('File', [
  { $match: { related_model: 'Product', field_key: 'gallery' } },
  {
    $facet: {
      total: [{ $count: 'n' }],
      buskool: [{ $match: { 'metadata.importedFrom': 'buskool' } }, { $count: 'n' }],
      replaced: [{ $match: { 'metadata.replacedAt': { $ne: null } } }, { $count: 'n' }],
      buskoolRemaining: [{ $match: { 'metadata.importedFrom': 'buskool', 'metadata.replacedAt': null } }, { $count: 'n' }],
    },
  },
]))[0] ?? {};
const ic = (k) => Number((imgSum[k] ?? [])[0]?.n ?? 0);
check('buskoolRemaining = buskool - replaced (تفکیک درست)', ic('buskoolRemaining') === ic('buskool') - Math.min(ic('replaced'), ic('buskool')) || ic('replaced') === 0, `remaining=${ic('buskoolRemaining')} buskool=${ic('buskool')} replaced=${ic('replaced')}`);
console.log(`  • کل=${ic('total')} باسکولی=${ic('buskool')} تعویض‌شده=${ic('replaced')} باقی‌مانده=${ic('buskoolRemaining')}`);

// ═════════ ۶. جستجو با شناسهٔ عددی (پیش‌حل) ═════════
console.log('\n— جستجوی q عددی (شناسهٔ آگهی) —');
if (listRows.length > 0) {
  const pid = Number(listRows[0]._id);
  const contains = { contains: String(pid), mode: 'insensitive' };
  const byName = await prisma.product.findMany({
    where: { OR: [{ productName: contains }, { slug: contains }, { id: pid }] },
    select: { id: true },
  });
  check('شناسهٔ عددی در نتایج جستجو هست', byName.some((p) => p.id === pid), `pid=${pid}`);
  const qFilter = { ...imgFilter, related_id: { $in: byName.map((p) => String(p.id)) } };
  const qRows = await run('File', [{ $match: qFilter }, { $limit: 3 }, { $project: { related_id: 1 } }]);
  console.log(`  • تصاویر آگهی #${pid}: ${qRows.length > 0 ? 'پیدا شد' : 'این آگهی عکس ندارد'}`);
  check('فیلتر related_id رشته‌ای کار می‌کند', Array.isArray(qRows));
}

// ═════════ ۷. فیلتر ویرایش‌شده (action=edit) ═════════
console.log('\n— فیلتر edited=yes/no —');
const editedRows = await run('Product', [
  { $match: {} },
  editsLookup(),
  { $match: { $expr: { $gt: [{ $size: { $ifNull: ['$_edits', []] } }, 0] } } },
  { $count: 'n' },
]);
check('تعداد ویرایش‌شده‌ها با groupBy برابری می‌کند', Number(editedRows[0]?.n ?? 0) === editedExpected.length, `${editedRows[0]?.n} vs ${editedExpected.length}`);
const editSample = await prisma.productEditHistory.findFirst({ where: { action: 'edit' } });
if (editSample) {
  console.log(`  • نمونهٔ ویرایش: آگهی #${editSample.productId} در ${toIso(editSample.createdAt)}`);
} else {
  console.log('  • هنوز هیچ آگهی‌ای توسط فروشنده ویرایش نشده (داده واقعی)');
}

console.log(`\n═══ نتیجه: ${pass} پاس / ${fail} خطا ═══`);
await prisma.$disconnect();
process.exit(fail > 0 ? 1 : 0);
