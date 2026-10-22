/* md-reader 本地朗读引擎：sherpa-onnx WASM + Matcha zh-en，模型从 OPFS 挂载。 */
'use strict';

const runtimeBase = new URL('./runtime/', self.location.href);
const MODEL_DIR = ['tts', 'matcha-zh-en', 'v1'];

let runtimeReady = false;
let initStarted = false;
let initDone = false;
let pendingInit = false;
let tts = null;

function post(message, transfer) {
  self.postMessage(message, transfer || []);
}

function errorMessage(err) {
  if (err instanceof Error) return `${err.message}\n${err.stack || ''}`;
  return String(err);
}

self.Module = {
  locateFile(file) {
    return new URL(file, runtimeBase).href;
  },
  setStatus(status) {
    post({ type: 'runtime-status', status: String(status) });
  },
  print(text) {
    post({ type: 'runtime-log', text: String(text) });
  },
  printErr(text) {
    post({ type: 'runtime-log', text: String(text), error: true });
  },
  onRuntimeInitialized() {
    runtimeReady = true;
    post({ type: 'runtime-ready' });
    if (pendingInit) void initEngine();
  },
};

importScripts(new URL('sherpa-onnx-tts.js', runtimeBase).href);
importScripts(new URL('sherpa-onnx-wasm-main-tts.js', runtimeBase).href);

function ensureMemfsDir(dir) {
  if (!dir || dir === '/') return;
  const parts = dir.split('/').filter(Boolean);
  let parent = '/';
  for (const part of parts) {
    const next = parent === '/' ? `/${part}` : `${parent}/${part}`;
    try {
      self.Module.FS_createPath(parent, part, true, true);
    } catch {
      // 目录已存在
    }
    parent = next;
  }
}

function mountFile(relativePath, data) {
  const full = `/${relativePath}`;
  const slash = full.lastIndexOf('/');
  const dir = slash <= 0 ? '/' : full.slice(0, slash);
  const name = full.slice(slash + 1);
  ensureMemfsDir(dir);
  self.Module.FS_createDataFile(dir, name, data, true, true, true);
}

async function ensureOpfsDir(root, parts) {
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
  return dir;
}

async function walkOpfs(dir, base = '', out = []) {
  for await (const [name, handle] of dir.entries()) {
    const path = base ? `${base}/${name}` : name;
    if (typeof handle.entries === 'function') await walkOpfs(handle, path, out);
    else out.push(path);
  }
  return out;
}

const CONFIG = {
  offlineTtsModelConfig: {
    offlineTtsMatchaModelConfig: {
      acousticModel: '/model-steps-3.onnx',
      vocoder: '/vocos-16khz-univ.onnx',
      lexicon: '/lexicon.txt',
      tokens: '/tokens.txt',
      dataDir: '/espeak-ng-data',
      noiseScale: 0.667,
      lengthScale: 1.0,
    },
    numThreads: 1,
    debug: false,
    provider: 'cpu',
  },
  ruleFsts: '/phone-zh.fst,/date-zh.fst,/number-zh.fst',
  maxNumSentences: 1,
  silenceScale: 0.2,
};

async function initEngine() {
  if (initStarted || initDone) return;
  if (!runtimeReady) {
    pendingInit = true;
    return;
  }
  initStarted = true;
  pendingInit = false;
  const startedAt = performance.now();
  try {
    if (!navigator.storage?.getDirectory) throw new Error('当前浏览器不支持 OPFS');
    const root = await navigator.storage.getDirectory();
    const modelDir = await ensureOpfsDir(root, MODEL_DIR);
    const files = await walkOpfs(modelDir);
    if (files.length === 0) throw new Error('离线语音包不存在，请先下载');
    post({ type: 'status', text: `挂载离线语音包（${files.length} 个文件）…` });
    let done = 0;
    for (const file of files) {
      const parts = file.split('/');
      const name = parts.pop();
      const dir = await ensureOpfsDir(modelDir, parts);
      const handle = await dir.getFileHandle(name);
      const data = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      mountFile(file, data);
      done++;
      if (done % 20 === 0) post({ type: 'status', text: `挂载离线语音包（${done}/${files.length}）…` });
    }
    post({ type: 'status', text: '初始化 Matcha 模型…' });
    const initAt = performance.now();
    tts = createOfflineTts(self.Module, CONFIG);
    initDone = true;
    post({
      type: 'ready',
      sampleRate: tts.sampleRate,
      numSpeakers: tts.numSpeakers,
      loadMs: performance.now() - startedAt,
      initMs: performance.now() - initAt,
    });
  } catch (err) {
    initStarted = false;
    post({ type: 'error', message: errorMessage(err), phase: 'init' });
  }
}

self.onmessage = (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'init') {
    void initEngine();
    return;
  }
  if (data.type === 'synth') {
    if (!tts || !initDone) {
      post({ type: 'error', requestId: data.requestId, message: 'local-not-ready', phase: 'synth' });
      return;
    }
    try {
      const startedAt = performance.now();
      const audio = tts.generate({
        text: String(data.text || ''),
        sid: Number(data.sid) || 0,
        speed: Number(data.rate) || 1,
      });
      const synthMs = performance.now() - startedAt;
      post(
        {
          type: 'audio',
          requestId: data.requestId,
          samples: audio.samples,
          sampleRate: audio.sampleRate,
          synthMs,
          audioMs: (audio.samples.length / audio.sampleRate) * 1000,
        },
        [audio.samples.buffer],
      );
    } catch (err) {
      post({ type: 'error', requestId: data.requestId, message: errorMessage(err), phase: 'synth' });
    }
    return;
  }
  if (data.type === 'dispose') {
    try {
      tts?.free?.();
    } catch {
      // 忽略
    }
    tts = null;
    initDone = false;
    initStarted = false;
  }
};
