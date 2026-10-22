import { kvGet, kvSet } from '../data/db';
import { extractTarGz } from './tar';
import { ensureOpfsDir, getOpfsRoot, opfsFileExists, opfsSupported, removeOpfsDir, writeOpfsFile, type OpfsDirHandle } from './opfs';
import { MATCHA_ZH_EN_MANIFEST, type ModelFile, type ModelManifest } from './model-manifest';

const MODEL_INFO_KEY = 'tts.model';

export interface ModelInfo {
  id: string;
  version: string;
  storageDir: string;
  size: number;
  downloadedAt: number;
}

export type ModelPhase = 'idle' | 'checking' | 'downloading' | 'verifying' | 'extracting' | 'ready' | 'error';

export interface ModelProgress {
  phase: ModelPhase;
  file: string;
  loaded: number;
  total: number;
}

export interface DownloadOptions {
  onProgress?: (progress: ModelProgress) => void;
  signal?: AbortSignal;
  /** 测试注入用；默认 navigator.storage.getDirectory()。 */
  root?: OpfsDirHandle;
}

export function formatModelSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

export async function loadModelInfo(): Promise<ModelInfo | null> {
  try {
    const raw = await kvGet<unknown>(MODEL_INFO_KEY);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<ModelInfo>;
    if (
      typeof value.id !== 'string' ||
      typeof value.version !== 'string' ||
      typeof value.storageDir !== 'string' ||
      typeof value.size !== 'number'
    ) {
      return null;
    }
    return {
      id: value.id,
      version: value.version,
      storageDir: value.storageDir,
      size: value.size,
      downloadedAt: typeof value.downloadedAt === 'number' ? value.downloadedAt : 0,
    };
  } catch {
    return null;
  }
}

async function saveModelInfo(info: ModelInfo): Promise<void> {
  await kvSet(MODEL_INFO_KEY, info);
}

async function clearModelInfo(): Promise<void> {
  await kvSet(MODEL_INFO_KEY, null);
}

/** 元数据存在且关键文件在 OPFS 里，才算真正可用。 */
export async function isModelReady(root?: OpfsDirHandle): Promise<boolean> {
  if (!root && !opfsSupported()) return false;
  const info = await loadModelInfo();
  if (!info || info.id !== MATCHA_ZH_EN_MANIFEST.id || info.version !== MATCHA_ZH_EN_MANIFEST.version) return false;
  try {
    const opfsRoot = root ?? (await getOpfsRoot());
    return await opfsFileExists(opfsRoot, `${info.storageDir}/model-steps-3.onnx`);
  } catch {
    return false;
  }
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function ensureSpace(size: number): Promise<void> {
  try {
    const estimate = await navigator.storage.estimate();
    const quota = estimate.quota ?? 0;
    const usage = estimate.usage ?? 0;
    if (quota > 0 && quota - usage < size * 1.5) {
      throw new Error(`存储空间不足，至少需要 ${formatModelSize(Math.ceil((size * 1.5 - (quota - usage)) / 1024 / 1024) * 1024 * 1024)}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('存储空间不足')) throw err;
    // estimate 不可用时跳过检查
  }
}

async function fetchWithProgress(
  url: string,
  size: number,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal, mode: 'cors' });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || size;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress(buffer.byteLength, total);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const buffer = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer.buffer;
}

async function downloadFile(
  root: OpfsDirHandle,
  file: ModelFile,
  manifest: ModelManifest,
  onProgress: (progress: ModelProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const emit = (phase: ModelPhase, loaded: number, total = file.size) =>
    onProgress({ phase, file: file.path, loaded, total });
  emit('downloading', 0);
  const buffer = await fetchWithProgress(
    file.url,
    file.size,
    (loaded, total) => emit('downloading', loaded, total),
    signal,
  );
  emit('verifying', file.size);
  const hash = await sha256Hex(buffer);
  if (hash !== file.sha256) throw new Error(`校验失败：${file.path}`);
  if (file.archive) {
    emit('extracting', file.size);
    const target = await ensureOpfsDir(root, manifest.storageDir);
    await extractTarGz(new Uint8Array(buffer), target);
  } else {
    await writeOpfsFile(root, `${manifest.storageDir}/${file.path}`, buffer);
  }
}

/** 下载并解压整个模型；成功后写入元数据。 */
export async function downloadModel(
  manifest: ModelManifest = MATCHA_ZH_EN_MANIFEST,
  options: DownloadOptions = {},
): Promise<ModelInfo> {
  if (!options.root && !opfsSupported()) throw new Error('当前浏览器不支持 OPFS，无法保存离线语音包');
  const root = options.root ?? (await getOpfsRoot());
  const { onProgress = () => {}, signal } = options;
  const totalSize = manifest.files.reduce((sum, file) => sum + file.size, 0);
  onProgress({ phase: 'checking', file: '', loaded: 0, total: totalSize });
  await ensureSpace(totalSize);
  try {
    await navigator.storage.persist();
  } catch {
    // persist 不支持时忽略
  }
  await removeOpfsDir(root, manifest.storageDir);
  try {
    for (const file of manifest.files) {
      signal?.throwIfAborted();
      await downloadFile(root, file, manifest, onProgress, signal);
    }
    const info: ModelInfo = {
      id: manifest.id,
      version: manifest.version,
      storageDir: manifest.storageDir,
      size: totalSize,
      downloadedAt: Date.now(),
    };
    await saveModelInfo(info);
    onProgress({ phase: 'ready', file: '', loaded: info.size, total: info.size });
    return info;
  } catch (err) {
    await removeOpfsDir(root, manifest.storageDir);
    await clearModelInfo();
    onProgress({ phase: 'error', file: '', loaded: 0, total: totalSize });
    throw err;
  }
}

/** 删除离线语音包；调用方负责在删除后把引擎切回系统语音。 */
export async function deleteModel(root?: OpfsDirHandle): Promise<void> {
  const info = await loadModelInfo();
  if (info) {
    try {
      const opfsRoot = root ?? (await getOpfsRoot());
      await removeOpfsDir(opfsRoot, info.storageDir);
    } catch {
      // OPFS 不可用时只清元数据
    }
  }
  await clearModelInfo();
}
