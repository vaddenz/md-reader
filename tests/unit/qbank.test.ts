import { describe, expect, it } from 'vitest';
import { normalizeStem, parseBankText, qidOf } from '../../src/lib/qbank';

/** 便捷构造：对象 → JSONL 一行。 */
const line = (o: Record<string, unknown>) => JSON.stringify(o);
const QA = { id: 'Q1.1', type: '概念', question: '什么是事件循环？', answer: '- 事件循环是…' };

describe('normalizeStem / qidOf', () => {
  it('空白折叠：空格/换行变化不影响 qid，题干改写则变化', () => {
    expect(normalizeStem('  a   b\n c ')).toBe('a b c');
    expect(qidOf('a  b')).toBe(qidOf('a b'));
    expect(qidOf('a b')).not.toBe(qidOf('a c'));
    expect(qidOf('x')).toMatch(/^q_[0-9a-z]+$/);
  });
});

describe('parseBankText 基本解析', () => {
  it('问答：全字段解析、行号正确、顺序保持', () => {
    const text = [
      line({ ...QA, chapter: '2. 事件循环', section: '2.2 补充', hint: '想 libuv', tags: ['事件循环'], difficulty: '基础', source: '知识.md#2' }),
      '',
      line({ ...QA, id: 'Q1.2', question: '第二题？' }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings).toEqual([]);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      kind: 'qa', id: 'Q1.1', type: '概念', chapter: '2. 事件循环', section: '2.2 补充',
      hint: '想 libuv', tags: ['事件循环'], difficulty: '基础', source: '知识.md#2', line: 1,
    });
    expect(questions[0].qid).toBe(qidOf('什么是事件循环？'));
    expect(questions[1].line).toBe(3);
    expect(questions[1].answer).toBe('- 事件循环是…');
  });

  it('BOM 与空行容忍', () => {
    const { questions, warnings } = parseBankText(`\uFEFF${line(QA)}\n\n`);
    expect(warnings).toEqual([]);
    expect(questions).toHaveLength(1);
  });

  it('无效 JSON / 非对象 → invalid-json，坏行跳过、其余可用', () => {
    const text = ['not json', '[1,2]', line(QA)].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings.map((w) => [w.line, w.kind])).toEqual([[1, 'invalid-json'], [2, 'invalid-json']]);
    expect(questions).toHaveLength(1);
  });

  it('缺字段 / 空字符串 / 非法 kind', () => {
    const text = [
      line({ id: 'Q1', question: 'x' }),
      line({ ...QA, id: '' }),
      line({ ...QA, kind: 'choice' }),
      line({ ...QA, answer: '   ' }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings.map((w) => w.kind)).toEqual(['missing-field', 'empty-field', 'bad-type', 'empty-field']);
    expect(questions).toEqual([]);
  });

  it('可选字段类型错误只告警并忽略该字段', () => {
    const { questions, warnings } = parseBankText(line({ ...QA, chapter: 3, tags: 'x' }));
    expect(warnings.map((w) => w.kind)).toEqual(['bad-type', 'bad-type']);
    expect(questions[0].chapter).toBeUndefined();
    expect(questions[0].tags).toBeUndefined();
  });

  it('tags 非法元素丢弃并告警，合法元素保留', () => {
    const { questions, warnings } = parseBankText(line({ ...QA, tags: ['ok', 7, ''] }));
    expect(warnings.filter((w) => w.kind === 'bad-type')).toHaveLength(2);
    expect(questions[0].tags).toEqual(['ok']);
  });

  it('id 重复告警但保留；题干重复跳过后者', () => {
    const text = [line(QA), line({ ...QA, id: 'Q9', question: '另一题？' }), line({ ...QA, id: 'Q1.1', question: QA.question })].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings.map((w) => w.kind)).toEqual(['duplicate-id', 'duplicate-qid']);
    expect(questions).toHaveLength(2);
  });
});

describe('parseBankText 选择题', () => {
  const single = { id: 'S1', kind: 'single', type: '概念', question: '选哪个？', options: [{ key: 'A', text: '对' }, { key: 'B', text: '错' }], correct: ['A'] };

  it('单选 / 多选合法解析，answer 可选（解析）', () => {
    const text = [
      line({ ...single, answer: '因为 A。' }),
      line({ id: 'M1', kind: 'multiple', type: '辨析', question: '多选？', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }], correct: ['A', 'C'], answer: undefined }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings).toEqual([]);
    expect(questions[0]).toMatchObject({ kind: 'single', correct: ['A'], answer: '因为 A。' });
    expect(questions[1]).toMatchObject({ kind: 'multiple', correct: ['A', 'C'] });
    expect(questions[1].answer).toBeUndefined();
  });

  it('问答携带 options/correct → inapplicable-field（忽略该字段）', () => {
    const { questions, warnings } = parseBankText(line({ ...QA, correct: ['A'] }));
    expect(warnings.map((w) => w.kind)).toEqual(['inapplicable-field']);
    expect(questions[0].correct).toBeUndefined();
  });

  it('bad-options：选项少于 2 / key 重复 / text 为空', () => {
    const text = [
      line({ ...single, options: [{ key: 'A', text: '对' }] }),
      line({ ...single, options: [{ key: 'A', text: '1' }, { key: 'A', text: '2' }] }),
      line({ ...single, options: [{ key: 'A', text: '1' }, { key: 'B', text: ' ' }] }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings.map((w) => w.kind)).toEqual(['bad-options', 'bad-options', 'bad-options']);
    expect(questions).toEqual([]);
  });

  it('bad-correct：key 越界 / 单选多答 / 多选空答', () => {
    const text = [
      line({ ...single, correct: ['C'] }),
      line({ ...single, correct: ['A', 'B'] }),
      line({ id: 'M1', kind: 'multiple', type: '辨析', question: '多选？', options: single.options, correct: [] }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings.map((w) => w.kind)).toEqual(['bad-correct', 'bad-correct', 'bad-correct']);
    expect(questions).toEqual([]);
  });
});

describe('parseBankText 追问关系', () => {
  it('合法链无告警', () => {
    const text = [
      line(QA),
      line({ id: 'Q1.2', type: '追问', question: '继续？', answer: '- 继续答…', followUpOf: 'Q1.1' }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings).toEqual([]);
    expect(questions[1].followUpOf).toBe('Q1.1');
  });

  it('followUpOf 首尾空白被 trim（不误报悬空）', () => {
    const text = [
      line(QA),
      line({ id: 'Q1.2', type: '追问', question: '继续？', answer: '- 继续答…', followUpOf: '  Q1.1 ' }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings).toEqual([]);
    expect(questions[1].followUpOf).toBe('Q1.1');
  });

  it('悬空 / 自引用 / 成环 → bad-followup，但题目保留', () => {
    const text = [
      line({ id: 'A', type: '追问', question: '悬空？', answer: '- 答', followUpOf: '不存在' }),
      line({ id: 'B', type: '追问', question: '自指？', answer: '- 答', followUpOf: 'B' }),
      line({ id: 'C', type: '追问', question: '环 1？', answer: '- 答', followUpOf: 'D' }),
      line({ id: 'D', type: '追问', question: '环 2？', answer: '- 答', followUpOf: 'C' }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(questions).toHaveLength(4);
    expect(warnings.map((w) => [w.line, w.kind])).toEqual([
      [1, 'bad-followup'], [2, 'bad-followup'], [3, 'bad-followup'], [4, 'bad-followup'],
    ]);
  });
});
