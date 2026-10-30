#!/usr/bin/env bash
# ─── تست باچ ۳۱-۱۰ (بخش ۲): منطق پله‌ای + درصد عمومی + شمار دستی ───
# اجرا: bash scripts/test-tiered-campaign.sh
set -e
BASE=http://localhost:4000/api/v1

TOKEN=$(curl -s -X POST $BASE/admin/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"09196421264","password":"434343"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['token'])")
AUTH="Authorization: Bearer $TOKEN"

py() { python3 -c "$1"; }

# شناسه کمپین تعدادیِ فعال
CID=$(curl -s -X POST $BASE/admin/packages/getCampaigns -H "$AUTH" -H 'Content-Type: application/json' -d '{}' \
  | python3 -c "import json,sys; items=json.load(sys.stdin)['data']['items']; print(next(c['id'] for c in items if c['type']=='quantity' and c['running']))")
echo "✅ کمپین تعدادی: $CID"

report() {
  curl -s -X POST $BASE/admin/packages/getCampaigns -H "$AUTH" -H 'Content-Type: application/json' -d '{}' \
    | python3 -c "
import json,sys
items=json.load(sys.stdin)['data']['items']
c=next(x for x in items if x['id']=='$CID')
t=c['currentTier']
print(f\"  effective={c['effectiveCount']} real={c['purchaseCount']} manual={c['manualPurchaseCount']} final%={c['finalPercent']} current%={c['currentPercent']}\")
print(f\"  tier: {t and (t['from'], t['to'], t['percent'], 'bought='+str(t['boughtInTier']), 'spotsLeft='+str(t['spotsLeft']))}\")"
}

echo "── ۱) وضعیت اولیه (شمار واقعی ۰) ──"; report

echo "── ۲) شمار دستی = ۲۹ (پله ۱-۳۰ → فقط ۱ جا) ──"
curl -s -X POST $BASE/admin/packages/setCampaignPurchaseCount -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"id\":\"$CID\",\"manualPurchaseCount\":29}" > /dev/null
report

echo "── ۲ب) نمای کاربر در صفحه بسته‌ها ──"
curl -s -X POST $BASE/packages/getPlans -H 'Content-Type: application/json' -d '{}' | python3 -c "
import json,sys
c=json.load(sys.stdin)['data']['campaign']
t=c['currentTier']
print(f\"  purchaseCount={c['purchaseCount']} discount%={c['discountPercent']} tier={t['from']}-{t['to']} spotsLeft={t['spotsLeft']}\")"

echo "── ۳) شمار دستی = ۳۰ (خرید بعدی نفر ۳۱ → پله ۳۱-۶۰ با ۵۰٪) ──"
curl -s -X POST $BASE/admin/packages/setCampaignPurchaseCount -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"id\":\"$CID\",\"manualPurchaseCount\":30}" > /dev/null
report

echo "── ۴) شمار دستی = ۱۰۰ (بعد از همه پله‌ها، بدون درصد عمومی → تخفیف تمام) ──"
curl -s -X POST $BASE/admin/packages/setCampaignPurchaseCount -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"id\":\"$CID\",\"manualPurchaseCount\":100}" > /dev/null
report
curl -s -X POST $BASE/packages/getPlans -H 'Content-Type: application/json' -d '{}' | python3 -c "
import json,sys
d=json.load(sys.stdin)['data']
c=d['campaign']
print(f\"  کاربر: discount%={c['discountPercent']} tier={c['currentTier']} p6m_final={d['plans'][0]['finalAmount']}\")"

echo "── ۵) درصد عمومی ۳۰٪ (بعد از نفر ۱۰۰ تا پایان کمپین) ──"
CUR=$(curl -s -X POST $BASE/admin/packages/getCampaigns -H "$AUTH" -H 'Content-Type: application/json' -d '{}' \
  | python3 -c "import json,sys; print(json.dumps(next(x for x in json.load(sys.stdin)['data']['items'] if x['id']=='$CID'), ensure_ascii=False))")
python3 - "$CUR" <<'EOF' > /tmp/campaign_update.json
import json, sys
c = json.loads(sys.argv[1])
print(json.dumps({
  'id': c['id'], 'title': c['title'], 'description': c['description'] or '',
  'type': c['type'], 'discountPercent': c['discountPercent'],
  'manualDiscountPercent': c['manualDiscountPercent'],
  'finalPercent': 30,
  'manualPurchaseCount': c['manualPurchaseCount'],
  'startsAt': c['startsAt'], 'endsAt': c['endsAt'],
  'isActive': c['isActive'], 'tiers': c['tiers'],
}, ensure_ascii=False))
EOF
curl -s -X POST $BASE/admin/packages/upsertCampaign -H "$AUTH" -H 'Content-Type: application/json' \
  -d @/tmp/campaign_update.json > /dev/null
report
curl -s -X POST $BASE/packages/getPlans -H 'Content-Type: application/json' -d '{}' | python3 -c "
import json,sys
d=json.load(sys.stdin)['data']
c=d['campaign']
t=c['currentTier']
print(f\"  کاربر: discount%={c['discountPercent']} final%={c['finalPercent']} tier={t['from']}-{t['to']} spotsLeft={t['spotsLeft']} p6m_final={d['plans'][0]['finalAmount']}\")"

echo "── ۶) شمار دستی = ۱۲۰ → گزارش «از نفر ۱۰۱ به بعد تا پایان: ۳۰٪» ──"
curl -s -X POST $BASE/admin/packages/setCampaignPurchaseCount -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"id\":\"$CID\",\"manualPurchaseCount\":120}" > /dev/null
report
curl -s -X POST $BASE/packages/getPlans -H 'Content-Type: application/json' -d '{}' | python3 -c "
import json,sys
c=json.load(sys.stdin)['data']['campaign']
t=c['currentTier']
print(f\"  کاربر: {c['purchaseCount']} نفر خریدند — tier from={t['from']} to={t['to']} percent={t['percent']} spotsLeft={t['spotsLeft']}\")"

echo "── ۷) بازگردانی به حالت واقعی (پاک‌سازی تست) ──"
curl -s -X POST $BASE/admin/packages/setCampaignPurchaseCount -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"id\":\"$CID\",\"manualPurchaseCount\":null}" > /dev/null
python3 - "$CID" <<EOF > /tmp/campaign_restore.json
import json
print(json.dumps({'id': '$CID', 'finalPercent': None}))
EOF
# finalPercent را با upsert کامل به null برگردانیم (نیاز به کل بدنه)
CUR=$(curl -s -X POST $BASE/admin/packages/getCampaigns -H "$AUTH" -H 'Content-Type: application/json' -d '{}' \
  | python3 -c "import json,sys; print(json.dumps(next(x for x in json.load(sys.stdin)['data']['items'] if x['id']=='$CID'), ensure_ascii=False))")
python3 - "$CUR" <<'EOF' > /tmp/campaign_restore.json
import json, sys
c = json.loads(sys.argv[1])
print(json.dumps({
  'id': c['id'], 'title': c['title'], 'description': c['description'] or '',
  'type': c['type'], 'discountPercent': c['discountPercent'],
  'manualDiscountPercent': c['manualDiscountPercent'],
  'finalPercent': None, 'manualPurchaseCount': None,
  'startsAt': c['startsAt'], 'endsAt': c['endsAt'],
  'isActive': c['isActive'], 'tiers': c['tiers'],
}, ensure_ascii=False))
EOF
curl -s -X POST $BASE/admin/packages/upsertCampaign -H "$AUTH" -H 'Content-Type: application/json' \
  -d @/tmp/campaign_restore.json > /dev/null
report
echo "✅ تست کامل شد — وضعیت به قبل برگشت"
