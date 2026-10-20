const KEY = 'mdreader.token';

export function loadToken(): string | null {
  return globalThis.localStorage?.getItem(KEY) ?? null;
}
export function saveToken(t: string): void {
  globalThis.localStorage?.setItem(KEY, t);
}
export function clearToken(): void {
  globalThis.localStorage?.removeItem(KEY);
}

/** Token 掩码：长 Token 显示前缀 + 末 4 位；短 Token 全部以圆点遮蔽（绝不明文展示完整值）。 */
export function maskToken(t: string): string {
  if (t.length <= 8) return '••••';
  const tail = t.slice(-4);
  if (t.length <= 16) return `••••${tail}`;
  return `${t.slice(0, 12)}…${tail}`;
}
