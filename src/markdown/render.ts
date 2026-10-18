import MarkdownIt from 'markdown-it';
import mark from 'markdown-it-mark';
import GithubSlugger from 'github-slugger';
import type Token from 'markdown-it/lib/token.mjs';
import { hljs } from '../lib/hljs';
import { resolveAssetPath, resolveMdLink } from '../data/paths';

export interface Heading { id: string; text: string; level: number }
export interface RenderOptions { path: string; knownPaths: Set<string> }

interface RenderEnv { headings: Heading[]; slugger: GithubSlugger; opts: RenderOptions }

const md = new MarkdownIt({ html: false, breaks: true, linkify: true, typographer: false, highlight: null })
  .use(mark);

function inlineText(token: Token): string {
  let out = '';
  for (const child of token.children ?? []) {
    if (child.type === 'text' || child.type === 'code_inline') out += child.content;
  }
  return out;
}

// markdown-it 解析时会把非 ASCII 锚点 percent-encode（#标题 → #%E6%A0%87%E9%A2%98），
// 这里还原成源码原样，保证与标题 id（github-slugger 裸 slug）逐字一致。
function decodeAnchor(href: string): string {
  try { return decodeURI(href); } catch { return href; }
}

// 规则只注册一次，按 state.env 取当前文档的 slugger/headings。
// 若在 renderDoc 内 push，每次渲染都会叠加一条规则，旧规则会用旧闭包污染此前返回的 headings。
md.core.ruler.push('heading_ids', (state) => {
  const env = state.env as RenderEnv;
  for (let i = 0; i < state.tokens.length; i++) {
    const t = state.tokens[i];
    if (t.type === 'heading_open') {
      const inline = state.tokens[i + 1];
      const text = inlineText(inline);
      const id = env.slugger.slug(text);
      t.attrSet('id', id);
      env.headings.push({ id, text, level: Number(t.tag.slice(1)) });
    }
  }
  return true;
});

export function renderDoc(src: string, opts: RenderOptions): { html: string; headings: Heading[] } {
  const env: RenderEnv = { headings: [], slugger: new GithubSlugger(), opts };

  md.renderer.rules.link_open = (tokens, idx) => {
    const token = tokens[idx];
    const href = token.attrGet('href') ?? '';
    if (href.startsWith('#')) {
      // 原地锚点：保持原样，浏览器原生处理
      token.attrSet('href', decodeAnchor(href));
    } else {
      const resolved = resolveMdLink(opts.path, href);
      if (resolved) {
        if (opts.knownPaths.has(resolved.path)) {
          const to = resolved.anchor ? `?to=${encodeURIComponent(resolved.anchor)}` : '';
          token.attrSet('href', `#/doc/${encodeURIComponent(resolved.path)}${to}`);
          token.attrSet('class', 'in-app-link');
        } else {
          token.attrSet('href', '#');
          token.attrSet('data-dead', '文件不存在');
        }
      } else if (/^(https?:|mailto:)/i.test(href)) {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener');
      } else if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        // 其他相对引用（非 .md / 非外链，如指向仓库内图片或代码文件）
        token.attrSet('href', '#');
        token.attrSet('data-dead', '无法在应用内打开');
      }
    }
    return md.renderer.renderToken(tokens, idx, {});
  };

  md.renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx];
    const src = token.attrGet('src') ?? '';
    const alt = token.content ?? '';
    if (/^(https?:|data:|blob:)/i.test(src)) {
      return `<img src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(alt)}" loading="lazy" class="md-img">`;
    }
    const repoPath = resolveAssetPath(opts.path, src) ?? src;
    return `<img alt="${md.utils.escapeHtml(alt)}" loading="lazy" class="md-img" data-repo-src="${md.utils.escapeHtml(repoPath)}">`;
  };

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = token.info.trim();
    const code = token.content;
    if (info === 'mermaid') {
      return `<div class="md-mermaid" data-code="${encodeURIComponent(code)}"></div>`;
    }
    const lang = info.split(/\s+/)[0] || '';
    let highlighted: string;
    try {
      highlighted = lang && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang }).value
        : md.utils.escapeHtml(code);
    } catch {
      highlighted = md.utils.escapeHtml(code);
    }
    return `<div class="code-block"><button class="code-copy" type="button">复制</button><pre><code class="hljs">${highlighted}</code></pre></div>`;
  };

  const html = md.render(src, env);
  return { html, headings: env.headings };
}
