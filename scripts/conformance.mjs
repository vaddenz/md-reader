// scripts/conformance.mjs — 渲染对拍（可选工具）：拿 GitHub 官方渲染的标题 slug 与本地 github-slugger 对比。
// 用法：GH_TOKEN=xxx npm run conformance -- <仓库内 md 相对路径>
// 环境变量：
//   REPO  — 目标仓库，默认 your-name/your-notes，可写成 owner/repo@ref
//   REF   — 目标分支/标签，默认 main
//   LOCAL — 本地 clone 根目录（指定后原文从本地读取，HTML 仍从 GitHub 拉取）
// 退出码：0 = 无差异；1 = slug 集合有差异；2 = 用法/环境/网络错误。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import GithubSlugger from 'github-slugger';

const USAGE = '用法: GH_TOKEN=xxx npm run conformance -- <仓库内 md 相对路径>';
const DEFAULT_REPO = 'your-name/your-notes';
const DEFAULT_REF = 'main';

const token = process.env.GH_TOKEN;
if (!token) {
  console.error('缺少 GH_TOKEN。示例: GH_TOKEN=$(gh auth token) npm run conformance -- AGENTS.md');
  process.exit(2);
}
const rawArg = process.argv[2];
if (!rawArg) {
  console.error(USAGE);
  process.exit(2);
}
const path = rawArg.replace(/^\.?\//, '').replace(/^\/+/, '');

const [repoEnv, refFromRepo] = (process.env.REPO || DEFAULT_REPO).split('@');
const [owner, repo] = repoEnv.split('/');
if (!owner || !repo) {
  console.error(`REPO 需为 owner/repo 或 owner/repo@ref 形式，当前: ${process.env.REPO}`);
  process.exit(2);
}
const ref = process.env.REF || refFromRepo || DEFAULT_REF;

// 与 corpus.mjs 相同的行级解析：标题只在围栏代码块之外统计。
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;

function localSlugs(src) {
  const slugger = new GithubSlugger();
  const slugs = [];
  let fence = null;
  for (const line of src.split(/\r?\n/)) {
    const m = FENCE_RE.exec(line);
    if (fence) {
      if (m && m[1][0] === fence.char && m[1].length >= fence.len && m[2].trim() === '') fence = null;
      continue;
    }
    if (m) {
      fence = { char: m[1][0], len: m[1].length };
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (h) slugs.push(slugger.slug((h[2] ?? '').trim()));
  }
  return slugs;
}

// GitHub 渲染 HTML 里标题锚点形如 <a id="user-content-<slug>" class="anchor">，去掉固定前缀后与裸 slug 对齐。
function githubSlugs(html) {
  return [...html.matchAll(/id="user-content-([^"]+)"/g)].map((m) => m[1]);
}

const apiPath = path.split('/').map(encodeURIComponent).join('/');
const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${apiPath}?ref=${encodeURIComponent(ref)}`;

async function request(url, accept) {
  let res;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'md-reader-conformance',
      },
    });
  } catch (err) {
    console.error(`请求失败: ${url}\n${err.message}`);
    process.exit(2);
  }
  const body = await res.text();
  if (!res.ok) {
    let detail = body.slice(0, 300);
    try {
      detail = JSON.parse(body).message ?? detail;
    } catch {
      // 非 JSON 错误体直接截断展示
    }
    console.error(`GitHub API 返回 ${res.status}: ${detail}`);
    process.exit(2);
  }
  return body;
}

// Accept: application/vnd.github.html+json 的响应体是渲染后的 HTML；
// 少数代理/版本可能返回 JSON（content 字段为 HTML），这里两种都兼容。
function htmlFromBody(body) {
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(body).content ?? '';
    } catch {
      return body;
    }
  }
  return body;
}

const html = htmlFromBody(await request(apiBase, 'application/vnd.github.html+json'));

let source;
if (process.env.LOCAL) {
  const localFile = join(process.env.LOCAL, path);
  try {
    source = readFileSync(localFile, 'utf8');
  } catch {
    console.error(`本地文件不存在: ${localFile}（LOCAL=${process.env.LOCAL}）`);
    process.exit(2);
  }
} else {
  source = await request(apiBase, 'application/vnd.github.raw');
}

const remote = githubSlugs(html);
const local = localSlugs(source);
const remoteSet = new Set(remote);
const localSet = new Set(local);
const missing = [...remoteSet].filter((s) => !localSet.has(s)).sort();
const extra = [...localSet].filter((s) => !remoteSet.has(s)).sort();

console.log('渲染对拍报告');
console.log(`仓库: ${owner}/${repo}@${ref}`);
console.log(`文件: ${path}${process.env.LOCAL ? ` (本地原文: ${process.env.LOCAL})` : ''}`);
console.log(`GitHub slug 数: ${remote.length}`);
console.log(`本地 slug 数: ${local.length}`);
console.log(`missing (GitHub 有、本地无): ${missing.length}`);
for (const s of missing) console.log(`  - ${s}`);
console.log(`extra (本地有、GitHub 无): ${extra.length}`);
for (const s of extra) console.log(`  - ${s}`);

const failed = missing.length > 0 || extra.length > 0;
console.log(failed ? '对拍失败：slug 集合存在差异' : '对拍通过：slug 集合完全一致');
process.exit(failed ? 1 : 0);
