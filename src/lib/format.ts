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

/** 字节数 → 可读体积文案（B / KB / MB / GB / TB，二进制进位 1024，保留 1 位小数）。非法值兜底为 0 B。 */
export function bytesToText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${units[unit]}`;
}
