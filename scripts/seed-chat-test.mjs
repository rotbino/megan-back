/**
 * دیتای تست چت — از طریق API واقعی (idempotent):
 *   • فروشنده (سعید محمدی) + خریدار (مریم احمدی) + خریدار ۲ (رضا کریمی)
 *   • یک آگهی confirmed برای فروشنده (درج مستقیم DB با Counter)
 *   • مکالمه ۱: ۳۰ پیام (تست پیجینگ) + مکالمه ۲: ۳ پیام
 *   • دو پیام پشتیبانی (ادمین → خریدار)
 * خروجی: /tmp/chat-test-data.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const BASE = 'http://localhost:4000/api/v1'
const STATE = '/tmp/chat-test-data.json'
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function post(path, body, token) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function login(phone) {
  for (let i = 0; i < 6; i++) {
    const v = await post('auth/login', { phone })
    const d = v.json?.data
    if (d?.accessToken) {
      const p = await post('users/getProfile', {}, d.accessToken)
      return { token: d.accessToken, userId: p.json?.data?.user?.id, phone }
    }
    if (String(v.json?.message || '').includes('Too Many Requests')) {
      console.log(`throttled ${phone}, waiting 20s…`)
      await sleep(20_000)
      continue
    }
    throw new Error(`login failed ${phone}: ${JSON.stringify(v.json).slice(0, 200)}`)
  }
  throw new Error(`login throttled: ${phone}`)
}

async function main() {
  const { PrismaClient } = await import('../node_modules/@prisma/client/default.js')
  const { config } = await import('../node_modules/dotenv/dist/index.cjs')
  config({ path: '.env', override: true })
  const { applyProfile } = await import('./lib/profile.mjs')
  applyProfile()
  const prisma = new PrismaClient()

  const seller = state.seller ?? (await login('09140000001'))
  const buyer = state.buyer ?? (await login('09140000002'))
  const buyer2 = state.buyer2 ?? (await login('09140000003'))
  console.log('seller:', seller.userId, '| buyer:', buyer.userId, '| buyer2:', buyer2.userId)
  await post('users/updateProfile', { firstName: 'سعید', lastName: 'محمدی' }, seller.token)
  await post('users/updateProfile', { firstName: 'مریم', lastName: 'احمدی' }, buyer.token)
  await post('users/updateProfile', { firstName: 'رضا', lastName: 'کریمی' }, buyer2.token)
  Object.assign(state, { seller, buyer, buyer2 })
  writeFileSync(STATE, JSON.stringify(state, null, 2))

  // ─── آگهی confirmed برای فروشنده ───
  let product
  if (state.productId) {
    product = await prisma.product.findUnique({ where: { id: state.productId } })
  }
  if (!product) {
    product = await prisma.product.findFirst({ where: { userId: seller.userId, status: 'confirmed' } })
  }
  if (!product) {
    const tehran = await prisma.location.findFirst({ where: { type: 'province', name: { contains: 'تهران' } } })
    const province = tehran ?? (await prisma.location.findFirst({ where: { type: 'province' } }))
    const city = await prisma.location.findFirst({ where: { type: 'city', parentId: province.id } })
    let sub = await prisma.category.findUnique({ where: { id: 44 } }).catch(() => null)
    if (!sub) sub = await prisma.category.findFirst({ where: { parentId: null } })
    const parent = sub?.parentId ? await prisma.category.findUnique({ where: { id: sub.parentId } }) : sub
    const pid = (await prisma.counter.upsert({
      where: { id: 'product' },
      update: { seq: { increment: 1 } },
      create: { id: 'product', seq: 9001 },
    })).seq
    product = await prisma.product.create({
      data: {
        id: pid,
        productName: 'پسته اکبری درجه یک',
        slug: `خرید-عمده-پسته-اکبری-${pid}`,
        description: 'پسته اکبری باغی، درجه یک، سال جدید',
        categoryId: parent?.id ?? sub.id,
        subCategoryId: sub.id,
        unit: sub.unit || 'کیلوگرم',
        provinceId: province.buskolId,
        cityId: city.buskolId,
        stock: 1000,
        minSaleAmount: 10,
        minSalePrice: 850000,
        status: 'confirmed',
        userId: seller.userId,
      },
    })
  }
  state.productId = product.id
  writeFileSync(STATE, JSON.stringify(state, null, 2))
  console.log('product:', product.id, product.productName)

  // ─── مکالمه ۱ — ۳۰ پیام (پیجینگ) ───
  let threadId = state.threadId
  if (!threadId) {
    const t1 = await post('chat/startThread', { productId: product.id }, buyer.token)
    threadId = t1.json?.data?.id
    state.threadId = threadId
    writeFileSync(STATE, JSON.stringify(state, null, 2))
  }
  console.log('thread1:', threadId)

  const existingCount = await prisma.chatMessage.count({ where: { threadId } })
  if (existingCount < 30) {
    const conv1 = [
      'سلام، وقت بخیر. پسته اکبری دارید؟',
      'سلام، بخیر. بله موجوده',
      'سال جدیدنه یا چند ماهیه؟',
      'همه سال جدید، چیده شده ۲ هفته پیشه',
      'قیمت هر کیلو چنده؟',
      'برای خرید بالای ۱۰ کیلو ۸۵۰ هزار تومن',
      'نمونه عکس دارید؟',
      'بله الان می‌فرستم',
      'ظاهرش خیلی خوبه',
      'درجه یک باغیه، خیالتون راحت',
      'حداقل سفارش چنده؟',
      '۱۰ کیلو',
      'ارسال به کرج دارید؟',
      'بله، باربری از تهران',
      'هزینه ارسال با کیه؟',
      'خریدار پرداخت می‌کنه',
      'می‌تونم فردا تشریف بیارم ببینم؟',
      'خوش اومدید، از ۹ صبح تا ۸ شب',
      'آدرس دقیق کجاست؟',
      'بازار تهران، راسته پسته‌فروش‌ها',
      'پارکینگ جای مشکل نداره؟',
      'نه، جای زیاده',
      'کارت‌به‌کارت هم قبول می‌کنید؟',
      'بله، یا همون‌جا نقدی',
      'فاکتور رسمی هم می‌دید؟',
      'بله، با مهر و امضا',
      'بسته‌بندی چطوره؟',
      'کیسه‌های ۵ کیلویی وکیوم',
      'ممنون از توضیحاتتون',
      'خواهش می‌کنم، منتظرتونیم',
    ]
    for (let i = existingCount; i < conv1.length; i++) {
      const mine = i % 2 === 0
      const r = await post('chat/sendMessage', { threadId, text: conv1[i] }, mine ? buyer.token : seller.token)
      if (r.json?.status === false) console.log('send err', i, JSON.stringify(r.json).slice(0, 120))
      await sleep(120)
    }
    console.log('conv1 total now:', await prisma.chatMessage.count({ where: { threadId } }))
  } else {
    console.log('conv1 already seeded:', existingCount)
  }

  // ─── مکالمه ۲ — ۳ پیام ───
  if (!state.thread2) {
    const t2r = await post('chat/startThread', { productId: product.id }, buyer2.token)
    const thread2 = t2r.json?.data?.id
    await post('chat/sendMessage', { threadId: thread2, text: 'سلام، ۵۰ کیلو پسته اکبری می‌خوام. قیمت بهتری می‌دید؟' }, buyer2.token)
    await post('chat/sendMessage', { threadId: thread2, text: 'سلام. برای ۵۰ کیلو ۸۲۰ می‌تونم بدم' }, seller.token)
    await post('chat/sendMessage', { threadId: thread2, text: 'عالیه، فردا تماس می‌گیرم' }, buyer2.token)
    state.thread2 = thread2
    writeFileSync(STATE, JSON.stringify(state, null, 2))
    console.log('thread2:', thread2)
  }

  // ─── دو پیام پشتیبانی برای خریدار ───
  const adminCount = await prisma.adminMessage.count({ where: { userId: buyer.userId } })
  if (adminCount === 0) {
    await prisma.adminMessage.createMany({
      data: [
        // readAt صریح null — فیلتر «خوانده‌نشده» پرایسما فقط null صریح را می‌گیرد
        { userId: buyer.userId, adminUsername: 'support', text: 'سلام، به ایمچ خوش آمدید. هر سوالی داشتید همین‌جا در خدمتیم.', readAt: null },
        { userId: buyer.userId, adminUsername: 'support', text: 'پیشنهاد ویژه این هفته: انتشار آگهی نردبانی با ۲۰٪ تخفیف.', readAt: null },
      ],
    })
  }
  console.log('admin messages:', await prisma.adminMessage.count({ where: { userId: buyer.userId } }))

  await prisma.$disconnect()
  console.log('✅ done → /tmp/chat-test-data.json')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
