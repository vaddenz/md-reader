/** 时间戳 → 相对时间文案（刚刚 / n 分钟前 / n 小时前 / n 天前）。 */
export function timeAgo(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (!Number.isFinite(diff) || diff < 60_000) return '刚刚';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
