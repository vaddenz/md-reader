// scripts/corpus.mjs — 语料体检：遍历目录下全部 *.md，校验页内锚点、统计 <mark> 误报与 mermaid 代码块。
// 用法：npm run corpus -- <markdown 目录>
// 基线（设计文档 §2，2026-10-18 实测）：unresolved=0、markCount=0、mermaid 命中 29 个文件。
// 退出码：0 = 通过；1 = unresolved>0 或 markCount>0；2 = 用法/目录错误。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import MarkdownIt from 'markdown-it';
import mark from 'markdown-it-mark';
import GithubSlugger from 'github-slugger';

const USAGE = '用法: npm run corpus -- <markdown 目录>';
const MAX_SAMPLES = 20;

const root = process.argv[2];
if (!root) {
  console.error(USAGE);
  process.exit(2);
}
let rootStat;
try {
  rootStat = statSync(root);
} catch {
  console.error(`目录不存在: ${root}`);
  process.exit(2);
}
if (!rootStat.isDirectory()) {
  console.error(`不是目录: ${root}`);
  process.exit(2);
}
const rootAbs = resolve(root);

// 与 src/markdown/render.ts 的渲染口径保持一致（html:false / breaks / linkify / 无 typographer）
const md = new MarkdownIt({ html: false, breaks: true, linkify: true, typographer: false }).use(mark);

// 行级解析：标题与锚点链接只在围栏代码块之外统计。
// 围栏开闭规则与 CommonMark 一致：≤3 空格缩进、``` 或 ~~~、闭合围栏不短于开启围栏且无 info。
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
// 匹配 ](#anchor) 与 ](#anchor "title")；锚点内不允许空白，与实测语料（1042 条）逐条吻合。
const ANCHOR_RE = /\]\(\s*#([^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

function scanOutsideFences(src) {
  const outside = [];
  const fences = [];
  let fence = null;
  for (const line of src.split(/\r?\n/)) {
    const m = FENCE_RE.exec(line);
    if (fence) {
      if (m && m[1][0] === fence.char && m[1].length >= fence.len && m[2].trim() === '') fence = null;
      continue;
    }
    if (m) {
      fence = { char: m[1][0], len: m[1].length };
      fences.push(m[2].trim());
      continue;
    }
    outside.push(line);
  }
  return { outside, fences };
}

function decodeAnchor(anchor) {
  try {
    return decodeURI(anchor);
  } catch {
    return anchor;
  }
}

function collect(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collect(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

const files = collect(rootAbs).sort();
const totals = {
  bytes: 0,
  headings: 0,
  anchorLinks: 0,
  unresolved: 0,
  markCount: 0,
  mermaidBlocks: 0,
};
const mermaidFiles = new Set();
const unresolvedSamples = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  totals.bytes += Buffer.byteLength(src);

  const { outside, fences } = scanOutsideFences(src);

  const slugger = new GithubSlugger();
  const slugs = new Set();
  for (const line of outside) {
    const m = HEADING_RE.exec(line);
    if (m) {
      slugs.add(slugger.slug((m[2] ?? '').trim()));
      totals.headings++;
    }
  }

  for (const line of outside) {
    for (const m of line.matchAll(ANCHOR_RE)) {
      totals.anchorLinks++;
      const anchor = decodeAnchor(m[1]);
      if (!slugs.has(anchor)) {
        totals.unresolved++;
        if (unresolvedSamples.length < MAX_SAMPLES) {
          unresolvedSamples.push(`${relative(rootAbs, file)}: #${anchor}`);
        }
      }
    }
  }

  const html = md.render(src, {});
  totals.markCount += (html.match(/<mark>/g) ?? []).length;

  // 与 render.ts 的 mermaid 判定一致：info 去掉首尾空白后严格等于 'mermaid'。
  const mermaid = fences.filter((info) => info === 'mermaid').length;
  totals.mermaidBlocks += mermaid;
  if (mermaid > 0) mermaidFiles.add(file);
}

console.log('语料体检报告');
console.log(`目录: ${rootAbs}`);
console.log(`files: ${files.length}`);
console.log(`totalBytes: ${totals.bytes}`);
console.log(`headings: ${totals.headings}`);
console.log(`anchorLinks: ${totals.anchorLinks}`);
console.log(`unresolved: ${totals.unresolved}`);
for (const sample of unresolvedSamples) console.log(`  - ${sample}`);
if (totals.unresolved > unresolvedSamples.length) {
  console.log(`  - …另有 ${totals.unresolved - unresolvedSamples.length} 条未展示`);
}
console.log(`markCount: ${totals.markCount}`);
console.log(`mermaidBlocks: ${totals.mermaidBlocks} (${mermaidFiles.size} files)`);

const failed = totals.unresolved > 0 || totals.markCount > 0;
console.log(failed ? '体检失败：存在未解析锚点或 <mark> 误报' : '体检通过：锚点全部可解析，无 <mark> 误报');
process.exit(failed ? 1 : 0);
