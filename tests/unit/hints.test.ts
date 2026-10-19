import { describe, expect, it } from 'vitest';
import { extractHintKeywords } from '../../src/lib/hints';

describe('extractHintKeywords', () => {
  it('提取行内代码、加粗词、列表首句短语；去重并限量 5 个', () => {
    const answer = [
      '- 当没有待执行的 `setImmediate` 时，poll 会阻塞。',
      '- 阻塞时长 = min(最近定时器, **平台最大等待时间**)。',
      '- `setImmediate` 与 `nextTick` 的关系：本轮之后。',
      '- 关键点：空闲时 CPU 接近 0。',
      '- 第五点：多余内容不应出现。',
    ].join('\n');
    const keys = extractHintKeywords(answer);
    expect(keys.length).toBeLessThanOrEqual(5);
    expect(keys[0]).toBe('setImmediate');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('空答案回退空数组；无结构化元素时取首句前 40 字', () => {
    expect(extractHintKeywords('')).toEqual([]);
    const long = '这是一段没有代码和加粗的很长很长的答案文本，用来验证回退到首句前四十个字符的行为是否正确。';
    const keys = extractHintKeywords(long);
    expect(keys).toHaveLength(1);
    expect(keys[0].length).toBeLessThanOrEqual(40);
  });
});
