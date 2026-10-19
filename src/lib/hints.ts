/** 提示关键词提取（spec §8.2 L2）：行内代码 → 加粗词 → 列表首句短语；去重、限量 5 个。 */
export function extractHintKeywords(answer: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  for (const m of answer.matchAll(/`([^`\n]+)`/g)) push(m[1]);
  for (const m of answer.matchAll(/\*\*([^*\n]+)\*\*/g)) push(m[1]);
  for (const line of answer.split('\n')) {
    const lead = line.replace(/^\s*(?:[-*+]|\d+[.、)])\s*/, '').split(/[：:，,。；;（(]/)[0].trim();
    if (lead && lead.length <= 20) push(lead);
    if (out.length >= 5) break;
  }
  if (!out.length && answer.trim()) push(answer.trim().slice(0, 40));
  return out.slice(0, 5);
}
