// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { buildChunks, cleanForSpeech, estimateSeconds, sentenceRanges } from '../../src/tts/segment';

function setup(html: string): HTMLElement {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById('root')!;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('cleanForSpeech', () => {
  it('拆 camelCase / PascalCase', () => {
    expect(cleanForSpeech('useEffect')).toBe('use Effect');
    expect(cleanForSpeech('SpeechSynthesis')).toBe('Speech Synthesis');
    expect(cleanForSpeech('getVoices()')).toBe('get Voices');
  });

  it('拆 snake_case / kebab-case，但保留日期与版本号', () => {
    expect(cleanForSpeech('use_reading_progress')).toBe('use reading progress');
    expect(cleanForSpeech('matcha-zh-en')).toBe('matcha zh en');
    expect(cleanForSpeech('2026-10-21')).toBe('2026-10-21');
    expect(cleanForSpeech('v1.8.0')).toBe('v1.8.0');
  });

  it('URL 不逐字读，Markdown 残留去掉', () => {
    expect(cleanForSpeech('见 https://example.com/a?b=1 。')).toContain('链接');
    expect(cleanForSpeech('**粗体** ==高亮== `code`')).toBe('粗体 高亮 code');
  });
});

describe('sentenceRanges', () => {
  it('按中文句号分句，短句合并', () => {
    const text = '这是第一句足够长的中文，用来避免被合并到下一句里。第二句也足够长，用来测试分句结果是否正确，避免被合并。第三句同样足够长，确保不会被合并到一起，单独成句。';
    const parts = sentenceRanges(text);
    expect(parts.length).toBe(3);
    expect(parts.every((p) => p.end > p.start)).toBe(true);
  });

  it('过短的句子与下一句合并', () => {
    const parts = sentenceRanges('好。这是一句足够长的中文，用来验证短句会与下一句合并。');
    expect(parts.length).toBe(1);
  });

  it('过长句硬切，单段不超过约 70 字', () => {
    const text = `${'一'.repeat(80)}。${'二'.repeat(80)}。`;
    const parts = sentenceRanges(text);
    expect(parts.length).toBeGreaterThanOrEqual(4);
    expect(parts.every((p) => p.end - p.start <= 71)).toBe(true);
  });
});

describe('buildChunks', () => {
  const html = `
    <h2>标题 useEffect</h2>
    <p>这是第一句中文，长度足够避免被合并到下一句里面去。第二句包含 useEffect 和 getVoices 调用，还有 https://example.com 这个链接。第三句是普通中文，用来测试分句是否正确。</p>
    <pre><code>const hidden = 1;</code></pre>
    <table><tbody><tr><td>单元格 A</td><td>单元格 B</td></tr></tbody></table>
    <p>最后一句带 <strong>粗体</strong> 和 <code>inlineCode</code>。</p>
  `;

  it('跳过代码与表格，句级切分，链接只读文字', () => {
    const root = setup(html);
    const chunks = buildChunks(root, { skipCode: true, readTable: false });
    const all = chunks.map((c) => c.text).join('\n');
    expect(all).not.toContain('hidden');
    expect(all).not.toContain('单元格');
    expect(all).toContain('use Effect');
    expect(all).toContain('get Voices');
    expect(all).toContain('链接');
    expect(all).toContain('inline Code');
    expect(all).not.toContain('`');
    expect(chunks.every((c) => c.ranges.length > 0)).toBe(true);
    expect(chunks.some((c) => c.kind === 'heading')).toBe(true);
  });

  it('readTable=true 时朗读单元格', () => {
    const root = setup(html);
    const chunks = buildChunks(root, { skipCode: true, readTable: true });
    expect(chunks.map((c) => c.text).join('\n')).toContain('单元格 A');
  });

  it('Range 指向原文，不因清洗而错位', () => {
    const root = setup(html);
    const chunks = buildChunks(root, { skipCode: true, readTable: false });
    const firstText = chunks.find((c) => c.text.startsWith('这是第一句'));
    expect(firstText).toBeTruthy();
    expect(firstText!.ranges[0].toString()).toContain('这是第一句');
    expect(firstText!.raw).toContain('这是第一句');
  });
});

describe('estimateSeconds', () => {
  it('中文按约 5 字/秒，语速翻倍时间减半', () => {
    const text = '一二三四五六七八九十';
    expect(estimateSeconds(text, 1)).toBeCloseTo(2, 5);
    expect(estimateSeconds(text, 2)).toBeCloseTo(1, 5);
  });
});
