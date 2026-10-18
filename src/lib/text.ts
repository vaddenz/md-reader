/** 提取文档标题：首个一级标题；缺省用文件名（去 .md）。 */
export function extractTitle(md: string, fallback = ''): string {
  const m = /^#\s+(.+)$/m.exec(md);
  if (m) return m[1].trim();
  return fallback.replace(/\.md$/, '');
}
