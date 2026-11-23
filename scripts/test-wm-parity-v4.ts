/**
 * تست برابری پورت TS با پایتون v4 — روی فایل‌های محلی (آفلاین).
 * پایتون: remove_one.py --json → (box, score, after.jpg)
 * TS: همین هسته → after.jpg
 * سنجه: هم‌خوانی باکس تشخیص + MAE خروجی نهایی (پس از decode هر دو JPEG).
 * اجرا: bun scripts/test-wm-parity-v4.ts
 */
import { detectWatermark, isStrong, removeWatermarkRgb, loadMaps } from '../src/importer/pascal-wm-core';
import sharp from 'sharp';

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

const TOOL = '/home/z/my-project/repos/megan-back/python/image-editing';
const ORIG = '/home/z/my-project/scripts/wm/originals';
const OUT = '/home/z/my-project/download/wm-v4/parity';
fs.mkdirSync(OUT, { recursive: true });

const FIDS = [
  '6af786519e0fa0f66aa2e95d',
  '6af8f2d0bc32309c947787d7',
  '6af9c2fe1d373690929bd3f0',
  '6af9cb5135c4a68325a38eb7',
  '6af9cf0535c4a68325a3955a',
  '6afa1e3b35c4a68325a3b64d',
  '6af9d1c135c4a68325a399e2',
  '6af9ac36d6118900aef951e0',
  '6afc7e9221e2f4642b205fe9',
  '6af9ac2dd6118900aef951d4',
];

async function decodeRgb(path: string): Promise<{ rgb: Uint8Array; w: number; h: number }> {
  const { data, info } = await sharp(path).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgb: new Uint8Array(data), w: info.width, h: info.height };
}

async function main() {
  loadMaps();
  let boxOk = 0;
  const maes: number[] = [];
  for (const fid of FIDS) {
    const src = `${ORIG}/${fid}.main.jpg`;
    if (!fs.existsSync(src)) continue;
    // ── پایتون (مرجع)
    const pyOut = `${OUT}/${fid}.py.jpg`;
    let py: any = null;
    try {
      const stdout = execFileSync('python3', [`${TOOL}/remove_one.py`, src, '-o', pyOut, '--json'], {
        cwd: TOOL,
        encoding: 'utf8',
        timeout: 120_000,
      });
      py = JSON.parse(stdout.trim().split('\n').pop()!);
    } catch (e: any) {
      console.log(`${fid.slice(0, 8)}  PY-ERROR ${String(e.message).slice(0, 80)}`);
      continue;
    }
    // ── TS
    const t0 = Date.now();
    const { rgb, w, h } = await decodeRgb(src);
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
    const det = await detectWatermark(gray, w, h);
    const strong = isStrong(det);
    const ms = Date.now() - t0;
    if (!strong || !det || py.status !== 'removed') {
      const agree = (!strong) === (py.status !== 'removed');
      console.log(`${fid.slice(0, 8)}  py=${py.status} ts=${strong ? 'removed' : 'not_found'} ${agree ? '✓' : '✗✗'}  ${ms}ms`);
      continue;
    }
    const box = removeWatermarkRgb(rgb, w, h, det)!;
    void box;
    const tsOut = `${OUT}/${fid}.ts.jpg`;
    await sharp(Buffer.from(rgb), { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality: 92 })
      .toFile(tsOut);
    // ── مقایسهٔ باکس + MAE پیکسلی (داخل باکس)
    const bx = Math.abs(det.x - py.x) <= 2 && Math.abs(det.y - py.y) <= 2 && Math.abs(det.w - py.w) <= 2;
    if (bx) boxOk++;
    const A = await decodeRgb(pyOut);
    const B = await decodeRgb(tsOut);
    const x1 = Math.max(0, Math.min(det.x, py.x));
    const y1 = Math.max(0, Math.min(det.y, py.y));
    const x2 = Math.min(w, Math.max(det.x + det.w, py.x + py.w));
    const y2 = Math.min(h, Math.max(det.y + det.h, py.y + py.h));
    let sum = 0;
    let cnt = 0;
    for (let j = y1; j < y2; j++) {
      for (let i = x1; i < x2; i++) {
        const p = (j * w + i) * 3;
        sum += Math.abs(A.rgb[p] - B.rgb[p]) + Math.abs(A.rgb[p + 1] - B.rgb[p + 1]) + Math.abs(A.rgb[p + 2] - B.rgb[p + 2]);
        cnt += 3;
      }
    }
    const mae = sum / cnt;
    maes.push(mae);
    console.log(
      `${fid.slice(0, 8)}  py(${py.score.toFixed(2)}, ${py.x},${py.y} ${py.w}x${py.h})  ts(${det.score.toFixed(2)}, ${det.x},${det.y} ${det.w}x${det.h} sp:${det.dx.toFixed(2)},${det.dy.toFixed(2)},${det.sf.toFixed(3)})  MAE=${mae.toFixed(2)}  ${ms}ms  ${bx && mae < 4 ? '✓' : '✗✗'}`,
    );
  }
  console.log(`\nباکس: ${boxOk}/${maes.length}  |  MAE میانگین: ${maes.length ? (maes.reduce((a, b) => a + b, 0) / maes.length).toFixed(2) : '-'}  |  بدترین: ${maes.length ? Math.max(...maes).toFixed(2) : '-'}`);
}
main();
