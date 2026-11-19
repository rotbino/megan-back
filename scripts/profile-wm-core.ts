/* پروفایل زمانی موتور TS — decode/detect/remove/encode جداگانه */
import * as fs from 'fs';
import { detectWatermark, isStrong } from '../src/importer/buskool-wm-core';

async function main() {
  const sharp = (await import('sharp')).default;
  const files = [
    '/home/z/my-project/repos/megan-back/python/image-editing/tests/golden-pair/6af9ac07d6118900aef951a8.jpg',
    '/home/z/my-project/repos/megan-back/python/image-editing/tests/golden-pair/6af9ac07d6118900aef951a9.jpg',
  ];
  for (const f of files) {
    const buf = fs.readFileSync(f);
    const meta = await sharp(buf).metadata();
    console.log(`\n${f.split('/').pop()} ${meta.width}x${meta.height}`);
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const { data, info } = await sharp(buf).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const t1 = Date.now();
      const w = info.width, h = info.height;
      const rgb = new Uint8Array(w * h * 3);
      if (info.channels === 3) rgb.set(data);
      const gray = new Float32Array(w * h);
      for (let j = 0; j < w * h; j++) gray[j] = 0.299*rgb[j*3] + 0.587*rgb[j*3+1] + 0.114*rgb[j*3+2];
      const det = await detectWatermark(gray, w, h);
      const t2 = Date.now();
      console.log(`  run${i + 1}: decode=${t1 - t0}ms detect=${t2 - t1}ms total=${t2 - t0}ms score=${det ? det.score.toFixed(3) : 'null'}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
