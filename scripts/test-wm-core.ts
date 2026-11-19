/**
 * تست برابری پورت TS با پایتون — همان ۸ فایل preview را پردازش می‌کند.
 * اجرا: bun scripts/test-wm-core.ts
 */
import { detectWatermark, isStrong, removeWatermarkRgb, loadMaps } from '../src/importer/buskool-wm-core';
import sharp from 'sharp';

const FILES: Array<{ fid: string; url: string; pyScore: number; pyScale: number; pyX: number; pyY: number }> = [
  { fid: '6af9d1c135c4a68325a399e2', url: 'https://daymatfilles.s3.ir-thr-at1.arvanstorage.ir/users/6af9d16a35c4a68325a39917/products/333139/gallery/mwi00bot-aaaff9a727.jpg', pyScore: 0.724, pyScale: 0.76, pyX: 48, pyY: 564 },
  { fid: '6afc7e9221e2f4642b205fe9', url: 'https://daymatfilles.s3.ir-thr-at1.arvanstorage.ir/users/6afc7e8b21e2f4642b205fe6/products/329371/gallery/mwkwdz7q-7393fc78be.jpg', pyScore: 0.92, pyScale: 1.0, pyX: 128, pyY: 47 },
  { fid: '6af9c2fe1d373690929bd3f0', url: 'https://daymatfilles.s3.ir-thr-at1.arvanstorage.ir/users/6af9c2eb1d373690929bd3d2/products/329264/gallery/mwhxresz-445eba0bdf.jpg', pyScore: 0.892, pyScale: 1.0, pyX: 177, pyY: 441 },
  { fid: '6af9ac2dd6118900aef951d4', url: 'https://daymatfilles.s3.ir-thr-at1.arvanstorage.ir/users/6af9abcdd6118900aef94f1f/products/332187/gallery/mwhua8e2-d72c0d4860.jpg', pyScore: 0.863, pyScale: 0.7, pyX: 566, pyY: 328 },
  { fid: '6af9cb5135c4a68325a38eb7', url: 'https://daymatfilles.s3.ir-thr-at1.arvanstorage.ir/users/6af9cb3535c4a68325a38e75/products/332778/gallery/mwhz116c-853674907c.jpg', pyScore: 0.879, pyScale: 1.0, pyX: 207, pyY: 10 },
  { fid: '6af9cf0535c4a68325a3955a', url: 'https://daymatfilles.s3.ir-thr-at1.arvanstorage.ir/users/6af9ccef335c4a68325a3953f/products/328940/gallery/mwhzlekd-6f3b345f1a.jpg', pyScore: 0.84, pyScale: 1.0, pyX: 129, pyY: 323 },
  { fid: '6af9ac36d6118900aef951e0', url: 'https://daymatfilles.s3.ir-thr-at1.arvanstorage.ir/users/6af9abcdd6118900aef94f1f/products/331726/gallery/mwhuaenc-57025819b5.jpg', pyScore: 0.884, pyScale: 1.0, pyX: 338, pyY: 71 },
  { fid: '6af9c33f1d373690929bd426', url: 'https://daymatfilles.s3.ir-thr-at1.arvanstorage.ir/users/6af9c3331d373690929bd41a/products/331694/gallery/mwhxssax-1cec18786f.jpg', pyScore: 0.308, pyScale: 0.55, pyX: 76, pyY: 398 },
];

async function main() {
  loadMaps();
  let ok = 0;
  let tot = 0;
  for (const f of FILES) {
    tot++;
    const t0 = Date.now();
    try {
      const res = await fetch(f.url, { headers: { 'user-agent': 'megan-wm-test' } });
      const buf = Buffer.from(await res.arrayBuffer());
      const { data, info } = await sharp(buf).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const rgb = new Uint8Array(data);
      const w = info.width;
      const h = info.height;
      const gray = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) gray[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
      const det = await detectWatermark(gray, w, h);
      const strong = isStrong(det);
      const dx = det ? det.x - f.pyX : -999;
      const dy = det ? det.y - f.pyY : -999;
      const match = strong === (f.pyScore >= 0.45) && Math.abs(dx) <= 3 && Math.abs(dy) <= 3;
      if (match) ok++;
      console.log(
        `${f.fid.slice(0, 10)}  py(${f.pyScore}, ${f.pyX},${f.pyY})  ts(${det ? det.score.toFixed(3) : 'null'}, ${det ? det.x + ',' + det.y : '-'}, evid ${det ? det.evidence.toFixed(1) : '-'})  Δ(${dx},${dy})  ${det ? det.w + 'x' + det.h : ''}  ${Date.now() - t0}ms  ${match ? '✓' : '✗✗✗'}`,
      );
      // ذخیرهٔ خروجی TS برای مقایسهٔ پیکسلی با پایتون
      if (strong && det) {
        const before = Buffer.from(rgb);
        const box = removeWatermarkRgb(rgb, w, h, det)!;
        await sharp(Buffer.from(rgb), { raw: { width: w, height: h, channels: 3 } })
          .jpeg({ quality: 92 })
          .toFile(`/tmp/ts-after-${f.fid}.jpg`);
        const side = Buffer.concat([]);
        void before; void box; void side;
      }
    } catch (e) {
      console.log(`${f.fid.slice(0, 10)}  ERROR ${(e as Error).message}`);
    }
  }
  console.log(`\n${ok}/${tot} هم‌خوان با پایتون`);
}
main();
