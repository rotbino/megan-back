/* تست مستقل پاک‌کنندهٔ ایمپورت — همان مسیر واقعی: cleanPascalWatermark */
import * as fs from 'fs';
import { cleanPascalWatermark } from '../src/importer/pascal-wm-clean';
import { detectWatermark, isStrong } from '../src/importer/pascal-wm-core';

async function grayOf(buf: Buffer): Promise<{ gray: Float32Array; w: number; h: number }> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(buf).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const rgb = new Uint8Array(w * h * 3);
  if (info.channels === 3) rgb.set(data);
  else for (let i = 0; i < w * h; i++) { rgb[i*3] = data[i]; rgb[i*3+1] = data[i]; rgb[i*3+2] = data[i]; }
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299*rgb[i*3] + 0.587*rgb[i*3+1] + 0.114*rgb[i*3+2];
  return { gray, w, h };
}

async function main() {
  const cases: Array<[string, string]> = [
    ['golden-A', '/home/z/my-project/repos/megan-back/python/image-editing/tests/golden-pair/6af9ac07d6118900aef951a8.jpg'],
    ['golden-B', '/home/z/my-project/repos/megan-back/python/image-editing/tests/golden-pair/6af9ac07d6118900aef951a9.jpg'],
    ...['1793634650952', '1793698291228'].map((n) => [`pasted-${n}`, `/home/z/my-project/upload/pasted_image_${n}.png`] as [string, string]),
  ];
  let pass = 0, fail = 0;
  for (const [name, path] of cases) {
    const buf = fs.readFileSync(path);
    const r = await cleanPascalWatermark(buf);
    console.log(`\n[${name}] status=${r.status} score=${r.score} ms=${r.ms} in=${buf.length}B out=${r.buf.length}B mime=${r.mimetype}`);
    if (r.status === 'removed') {
      const out = `/tmp/wm-clean-test/${name}-clean.jpg`;
      fs.mkdirSync('/tmp/wm-clean-test', { recursive: true });
      fs.writeFileSync(out, r.buf);
      // تشخیص مجدد روی خروجی — باید ضعیف/غایب باشد
      const g = await grayOf(r.buf);
      const det = await detectWatermark(g.gray, g.w, g.h);
      const strongAfter = isStrong(det);
      console.log(`  re-detect after clean: score=${det ? det.score.toFixed(3) : 'null'} strong=${strongAfter}`);
      if (!strongAfter) { console.log('  ✓ PASS (removed + stays removed)'); pass++; } else { console.log('  ✗ FAIL (still detected)'); fail++; }
    } else if (r.status === 'not_found') {
      const unchanged = r.buf.equals(buf);
      console.log(`  untouched=${unchanged}`);
      console.log(unchanged ? '  ✓ PASS (not_found, buffer untouched)' : '  ✗ FAIL (buffer changed!)');
      unchanged ? pass++ : fail++;
    } else {
      console.log('  ✗ FAIL (unexpected failed status)'); fail++;
    }
  }
  console.log(`\n=== ${pass} pass / ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
