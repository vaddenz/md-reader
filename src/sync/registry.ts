import type { SyncBackend, SyncBackendDefinition, SyncConfig } from './types';
import { SyncError } from './types';

const definitions = new Map<string, SyncBackendDefinition>();

export function registerSyncBackend(def: SyncBackendDefinition): void {
  definitions.set(def.type, def);
}

export function listSyncBackends(): SyncBackendDefinition[] {
  return [...definitions.values()];
}

export function getSyncBackend(type: string): SyncBackendDefinition | undefined {
  return definitions.get(type);
}

export function createSyncBackend(config: SyncConfig): SyncBackend {
  const def = getSyncBackend(config.backend);
  if (!def) throw new SyncError('config', '未知同步后端');
  const error = def.validate?.(config.values);
  if (error) throw new SyncError('config', error);
  return def.create(config.values);
}

export function isSyncConfigured(config: SyncConfig): boolean {
  if (!config.enabled) return false;
  const def = getSyncBackend(config.backend);
  if (!def) return false;
  if (def.validate) return def.validate(config.values) === null;
  return def.fields.every((f) => !f.required || Boolean(config.values[f.key]?.trim()));
}

export function shouldAutoSync(config: SyncConfig, online: boolean): boolean {
  return online && config.enabled && config.autoSync && isSyncConfigured(config);
}
