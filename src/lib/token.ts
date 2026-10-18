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
