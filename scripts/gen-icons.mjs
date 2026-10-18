// scripts/gen-icons.mjs — 生成 public/icon-192.png 与 icon-512.png（纯色底 + 三条白色"文本行"）
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
};

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function icon(size) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [0x1f, 0x6f, 0xeb], fg = [0xff, 0xff, 0xff];
  const barH = Math.round(size * 0.055), gap = Math.round(size * 0.10);
  const w1 = Math.round(size * 0.52), w2 = Math.round(size * 0.36);
  const x0 = Math.round(size * 0.24), y0 = Math.round(size * 0.34);
  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, bg);
  for (let row = 0; row < 3; row++) {
    const w = row === 2 ? w2 : w1;
    for (let y = y0 + row * (barH + gap); y < y0 + row * (barH + gap) + barH; y++)
      for (let x = x0; x < x0 + w; x++) put(x, y, fg);
  }
  return px;
}

mkdirSync('public', { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`public/icon-${size}.png`, png(size, icon(size)));
  console.log(`public/icon-${size}.png 已生成`);
}
