import type { SyncConfig } from './types';

const CONFIG_KEY = 'mdreader.syncConfig';

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  version: 1,
  enabled: false,
  autoSync: false,
  backend: 'neon',
  values: {},
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 清洗配置：只保留字符串值并 trim，endpoint 去掉末尾斜杠，布尔值必须显式为 true。 */
export function sanitizeSyncConfig(raw: unknown): SyncConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SYNC_CONFIG };
  const r = raw as Partial<SyncConfig>;
  const values: Record<string, string> = {};
  if (r.values && typeof r.values === 'object' && !Array.isArray(r.values)) {
    for (const [key, value] of Object.entries(r.values)) {
      if (typeof value === 'string') values[key] = value.trim();
    }
  }
  if (values.endpoint) values.endpoint = values.endpoint.replace(/\/+$/, '');
  return {
    version: 1,
    enabled: r.enabled === true,
    autoSync: r.autoSync === true,
    backend: text(r.backend) || DEFAULT_SYNC_CONFIG.backend,
    values,
  };
}

export function loadSyncConfig(): SyncConfig {
  try {
    const raw = safeStorage()?.getItem(CONFIG_KEY);
    return raw ? sanitizeSyncConfig(JSON.parse(raw)) : { ...DEFAULT_SYNC_CONFIG };
  } catch {
    return { ...DEFAULT_SYNC_CONFIG };
  }
}

export function saveSyncConfig(next: SyncConfig): SyncConfig {
  const clean = sanitizeSyncConfig(next);
  try {
    safeStorage()?.setItem(CONFIG_KEY, JSON.stringify(clean));
  } catch {
    // localStorage 不可用（隐私模式/配额）：本次运行由调用方持有内存态
  }
  return clean;
}

export function clearSyncConfig(): void {
  try {
    safeStorage()?.removeItem(CONFIG_KEY);
  } catch {
    // 忽略
  }
}

/** 连接身份指纹：backend/endpoint/token 任一变化即视为换库，需要清 cursor；autoSync 切换不影响。 */
export function syncConfigFingerprint(config: SyncConfig): string {
  return [config.backend, config.values.endpoint ?? '', config.values.token ?? ''].join('\n');
}
