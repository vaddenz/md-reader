import type { RepoDb } from './repoDb';

export type SyncErrorKind = 'config' | 'auth' | 'notfound' | 'network' | 'server' | 'parse';

export class SyncError extends Error {
  constructor(public kind: SyncErrorKind, message: string, public status?: number) {
    super(message);
    this.name = 'SyncError';
  }
}

export interface SyncConfig {
  version: 1;
  enabled: boolean;
  autoSync: boolean;
  backend: string;
  values: Record<string, string>;
}

export interface BackendField {
  key: string;
  label: string;
  type: 'url' | 'password' | 'text';
  placeholder?: string;
  help?: string;
  required: boolean;
}

export interface TestResult { warning?: string }

export interface SyncRecord {
  scope: string;
  collection: string;
  recordId: string;
  payload: unknown;
  updatedAt: number;
  deleted: boolean;
  deviceId: string;
}

export interface RemoteRecord extends SyncRecord {
  serverUpdatedAt: number;
}

export interface LocalRecord {
  recordId: string;
  updatedAt: number;
  deleted: boolean;
  payload: unknown | null;
}

export interface SyncBackend {
  test(signal?: AbortSignal): Promise<TestResult>;
  pull(scope: string, since: number, signal?: AbortSignal): Promise<RemoteRecord[]>;
  push(records: readonly SyncRecord[], signal?: AbortSignal): Promise<void>;
}

export interface SyncBackendDefinition {
  type: string;
  label: string;
  description: string;
  fields: BackendField[];
  create(values: Readonly<Record<string, string>>): SyncBackend;
  validate?(values: Readonly<Record<string, string>>): string | null;
}

export interface SyncCollection {
  name: string;
  label: string;
  listLocal(db: RepoDb): Promise<LocalRecord[]>;
  getLocal(db: RepoDb, recordId: string): Promise<LocalRecord | undefined>;
  applyRemote(db: RepoDb, record: RemoteRecord): Promise<boolean>;
  clearBefore?(db: RepoDb, before: number): Promise<void>;
}
