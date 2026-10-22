#!/usr/bin/env node
/**
 * 重新生成 public/tts/runtime 下的 sherpa-onnx WASM 运行时。
 *
 *   node scripts/tts-runtime-setup.mjs
 *
 * 从 ModelScope 官方 WebAssembly 空间下载预构建文件，并去掉内置 .data 模型包
 * （生产环境从 OPFS 挂载 Matcha 模型）。需要联网。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const repo = 'k2-fsa/web-assembly-tts-sherpa-onnx-en';
const api = (file) =>
  `https://modelscope.cn/api/v1/studio/${repo}/repo?Revision=master&FilePath=${encodeURIComponent(file)}`;
const out = path.resolve(import.meta.dirname, '..', 'public', 'tts', 'runtime');

/** 去掉生成的 `loadPackage({...})` 调用；模型文件由 worker 从 OPFS 挂载。 */
function stripDataPackage(source) {
  const call = source.lastIndexOf('loadPackage(');
  if (call < 0) throw new Error('运行时里找不到 loadPackage 调用');
  const start = source.indexOf('{', call);
  if (start < 0) throw new Error('找不到 loadPackage 参数');
  let depth = 0;
  let quote = '';
  let escaped = false;
  let end = -1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error('loadPackage 参数没有闭合');
  const close = source.indexOf(')', end);
  if (close < 0) throw new Error('loadPackage 调用没有闭合');
  return `${source.slice(0, call)}/* md-reader: models are mounted from OPFS by the worker */${source.slice(close + 1)}`;
}

async function fetchBytes(file) {
  const response = await fetch(api(file), { redirect: 'follow' });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

await mkdir(out, { recursive: true });
for (const file of ['sherpa-onnx-tts.js', 'sherpa-onnx-wasm-main-tts.wasm']) {
  const data = await fetchBytes(file);
  await writeFile(path.join(out, file), data);
  console.log(`${file} ${data.length} bytes`);
}
const main = new TextDecoder().decode(await fetchBytes('sherpa-onnx-wasm-main-tts.js'));
const patched = stripDataPackage(main);
await writeFile(path.join(out, 'sherpa-onnx-wasm-main-tts.js'), patched);
console.log(`sherpa-onnx-wasm-main-tts.js ${patched.length} bytes (patched)`);

const wasm = await readFile(path.join(out, 'sherpa-onnx-wasm-main-tts.wasm'));
console.log('wasm sha256', createHash('sha256').update(wasm).digest('hex'));
process.exit(0);
