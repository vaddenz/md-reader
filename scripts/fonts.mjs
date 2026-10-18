// 一次性字体获取与「无损」转换（仅格式转换，字形全集不变）；产物入库，不在 CI/构建中执行。
// 重跑幂等；上游体积变化时给出告警，需人工核对后更新本文件与 README。
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wawoff2 = require('wawoff2');

const JOBS = [
  {
    name: 'lxgw-neo-xihei-screen-full',
    url: 'https://github.com/lxgw/LxgwNeoXiZhi-Screen/releases/download/26.08.21/LXGWNeoXiHeiScreenFull.ttf',
    size: 11501566,
    sha256: '22150f8ffe4f0c1cfd9f4f97798c22f18dd2ec6b166c24f2c164442ca2e9a258',
  },
  {
    name: 'noto-serif-sc-variable',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf',
    size: 25125512,
    // 上游为 main 浮动引用：体积不符仅告警，需人工核对
  },
];

const LICENSES = [
  ['https://raw.githubusercontent.com/lxgw/LxgwNeoXiZhi-Screen/main/IPA_Font_License_Agreement_v1.0.txt', 'IPA_Font_License_Agreement_v1.0.txt'],
  ['https://raw.githubusercontent.com/lxgw/LxgwNeoXiZhi-Screen/main/licenses_of_other_incorporated_fonts.txt', 'licenses_of_other_incorporated_fonts.txt'],
  ['https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/OFL.txt', 'OFL.txt'],
];

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

const fontsDir = new URL('../public/fonts/', import.meta.url);
const licDir = new URL('../public/fonts/licenses/', import.meta.url);
await mkdir(fontsDir, { recursive: true });
await mkdir(licDir, { recursive: true });

for (const job of JOBS) {
  console.log(`→ ${job.name}`);
  const ttf = await download(job.url);
  if (ttf.byteLength !== job.size) {
    console.warn(`  ⚠ 体积与记录不符：期望 ${job.size}，实际 ${ttf.byteLength}（上游可能已更新，请核对）`);
  }
  if (job.sha256) {
    const got = createHash('sha256').update(ttf).digest('hex');
    if (got !== job.sha256) console.warn(`  ⚠ sha256 与记录不符：${got}`);
  }
  const woff2 = await wawoff2.compress(ttf);
  await writeFile(new URL(`${job.name}.woff2`, fontsDir), woff2);
  console.log(`  写出 ${job.name}.woff2（${(woff2.byteLength / 1024 / 1024).toFixed(1)} MB）`);
}

for (const [url, file] of LICENSES) {
  await writeFile(new URL(file, licDir), await download(url));
  console.log(`  许可：${file}`);
}
console.log('完成。产物在 public/fonts/，请提交入库。');
