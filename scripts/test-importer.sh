#!/bin/bash
# تست E2E ایمپورتر باسکول — علیه بک‌اند در حال اجرا (پیش‌فرض :4000)
# جریان: ping → stats → source-info → گیت ادمین (403) → ایمپورت تک‌کاربرهٔ
# il2016n با maxProducts=1 → پول جاب تا پایان → preview نتیجه.
#
# اجرا:  bash scripts/test-importer.sh [BASE_URL]
# نکته:  ایمپورت idempotent است (upsert) — اجرای مکرر مشکلی ندارد.
set -u
BASE="${1:-http://127.0.0.1:4000}/api/v1/importer"
ADMIN_PHONE="${IMPORTER_ADMIN_PHONE:-09196421264}"

echo "── ping:"
curl -s "$BASE/ping"; echo

echo "── stats:"
curl -s "$BASE/stats"; echo

echo "── source-info:"
curl -s "$BASE/source-info"; echo

echo "── cleanup با شماره اشتباه (منتظر 403):"
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$BASE/cleanup" \
  -H "Content-Type: application/json" -d '{"adminPhone":"09120000000"}'

echo "── شروع ایمپورت تک‌کاربره il2016n (maxProducts=1)…"
JOB=$(curl -s -X POST "$BASE/single" -H "Content-Type: application/json" \
  -d "{\"adminPhone\":\"$ADMIN_PHONE\",\"userName\":\"il2016n\",\"maxProducts\":1}")
echo "$JOB"
JOB_ID=$(echo "$JOB" | python3 -c "import sys,json;print(json.load(sys.stdin).get('data',{}).get('jobId',''))")
[ -z "$JOB_ID" ] && { echo "✖ jobId نگرفتیم"; exit 1; }

echo "── پول تا پایان (حداکثر ۲۴۰ ثانیه — فاصلهٔ پیش‌فرض باسکول ۵ ثانیه است):"
for i in $(seq 1 48); do
  sleep 5
  STATUS=$(curl -s "$BASE/jobs/$JOB_ID" | python3 -c "
import sys,json
d=(json.load(sys.stdin).get('data') or {})
print(d.get('status','?'), d.get('counters',{}).get('products',0), d.get('counters',{}).get('imagesDownloaded',0), d.get('counters',{}).get('reviews',0))
" 2>/dev/null)
  echo "  [$((i*5))s] $STATUS"
  case "$STATUS" in done*|failed*|stopped*) break;; esac
done

echo "── جزئیات جاب:"
curl -s "$BASE/jobs/$JOB_ID" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
print('status:', d['status'], '| error:', d.get('error'))
print('counters:', json.dumps(d['counters'], ensure_ascii=False))
print('steps:', ', '.join(s['key']+':'+s['status'] for s in d['steps']))
print('log:')
for l in d['log']: print('   ', l['level'][:4].upper(), l['msg'][:130])
"

echo "── preview:"
curl -s "$BASE/preview/il2016n" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
u=d['user']
print('user:', u['userName'], u['firstName'], u['lastName'], '| verified:', u['isVerified'], '| bUserId:', u['bUserId'])
print('counts:', json.dumps(d['counts'], ensure_ascii=False))
for p in d['products'][:3]:
    print('  product:', p['bProductId'], p['name'], '| price:', p['price'], '| photos:', len(p['photos']))
for r in d['reviews'][:3]:
    print('  review:', r['rating'], '★', r['reviewer']['firstName'], r['reviewer']['lastName'], '| stub:', r['reviewer']['isStub'])
"

echo "── ALL DONE"
