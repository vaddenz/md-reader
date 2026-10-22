import Drawer from './Drawer';
import { voiceKey } from '../tts/voices';
import { formatModelSize, type ModelInfo, type ModelPhase, type ModelProgress } from '../tts/model-store';
import type { PlayerState, TtsEngine, TtsPrefs } from '../tts/types';

interface TtsSheetProps {
  state: PlayerState;
  prefs: TtsPrefs;
  engine: TtsEngine;
  voiceOptions: SpeechSynthesisVoice[];
  hasAnyVoice: boolean;
  selectedVoice: SpeechSynthesisVoice | null;
  loadingVoices: boolean;
  sleepMinutes: number | 'off';
  error?: string;
  modelSupported: boolean;
  modelReady: boolean;
  modelInfo: ModelInfo | null;
  modelStatus: ModelPhase;
  modelProgress: ModelProgress;
  onClose: () => void;
  onSetRate: (rate: number) => void;
  onSetVoiceKey: (key: string | null) => void;
  onSetPrefs: (patch: Partial<TtsPrefs>) => void;
  onSetEngine: (engine: TtsEngine) => void;
  onDownloadModel: () => void;
  onCancelDownload: () => void;
  onDeleteModel: () => void;
  onSetSleepMinutes: (minutes: number | 'off') => void;
  onRestart: () => void;
  onStop: () => void;
  onRefreshVoices: () => void;
  onOpenToc: () => void;
}

const RATES = [0.75, 1, 1.25, 1.5, 2];
const MODEL_MB = 140;

/** 朗读设置面板：引擎、离线语音包、音色、语速、睡眠定时、跳过项。 */
export default function TtsSheet({
  state,
  prefs,
  engine,
  voiceOptions,
  hasAnyVoice,
  selectedVoice,
  loadingVoices,
  sleepMinutes,
  error,
  modelSupported,
  modelReady,
  modelInfo,
  modelStatus,
  modelProgress,
  onClose,
  onSetRate,
  onSetVoiceKey,
  onSetPrefs,
  onSetEngine,
  onDownloadModel,
  onCancelDownload,
  onDeleteModel,
  onSetSleepMinutes,
  onRestart,
  onStop,
  onRefreshVoices,
  onOpenToc,
}: TtsSheetProps) {
  const failed = state === 'error' || state === 'no-voice' || state === 'blocked';
  const downloading = ['checking', 'downloading', 'verifying', 'extracting'].includes(modelStatus);
  const progressPct = modelProgress.total > 0 ? Math.min(100, (modelProgress.loaded / modelProgress.total) * 100) : 0;

  return (
    <Drawer title="朗读" onClose={onClose} className="tts-sheet-drawer">
      <div className="tts-sheet">
        {failed && <p className="tts-sheet-error">{state === 'blocked' ? '浏览器拦截了朗读，点按播放键重试。' : error || '朗读暂不可用。'}</p>}

        <section className="tts-sheet-section">
          <h3>引擎</h3>
          <div className="tts-rate-row" role="group" aria-label="朗读引擎">
            <button
              type="button"
              className={engine === 'system' ? 'tts-chip tts-chip-on' : 'tts-chip'}
              aria-pressed={engine === 'system'}
              onClick={() => onSetEngine('system')}
            >
              系统语音
            </button>
            <button
              type="button"
              className={engine === 'local' ? 'tts-chip tts-chip-on' : 'tts-chip'}
              aria-pressed={engine === 'local'}
              onClick={() => onSetEngine('local')}
              disabled={!modelReady}
            >
              离线语音包
            </button>
          </div>
          {!modelSupported && <p className="tts-sheet-note">当前浏览器不支持离线语音包（需要 OPFS）。</p>}
          {modelSupported && !modelReady && !downloading && (
            <p className="tts-sheet-note">
              离线语音包约 {MODEL_MB}MB，下载后本机离线合成；文件来自 ModelScope CDN。
            </p>
          )}
          {modelSupported && modelStatus === 'error' && <p className="tts-sheet-note">上次下载失败，请重试。</p>}
          {downloading && (
            <div className="tts-model-progress">
              <div className="tts-model-progress-track">
                <i style={{ width: `${progressPct}%` }} />
              </div>
              <p>
                {modelStatus === 'extracting' ? '解压中' : modelStatus === 'verifying' ? '校验中' : '下载中'}
                {modelProgress.file ? ` · ${modelProgress.file}` : ''}
              </p>
            </div>
          )}
          {modelReady && modelInfo && (
            <p className="tts-sheet-note">
              已下载 · {formatModelSize(modelInfo.size)} · 版本 {modelInfo.version}
              {modelInfo.downloadedAt ? ` · ${new Date(modelInfo.downloadedAt).toLocaleDateString()}` : ''}
            </p>
          )}
          <div className="tts-sheet-actions tts-model-actions">
            {modelSupported && !modelReady && !downloading && (
              <button type="button" className="tts-sheet-btn" onClick={onDownloadModel}>下载离线语音包</button>
            )}
            {downloading && (
              <button type="button" className="tts-sheet-btn" onClick={onCancelDownload}>取消下载</button>
            )}
            {modelReady && (
              <button type="button" className="tts-sheet-btn tts-sheet-btn-danger" onClick={onDeleteModel}>删除离线语音包</button>
            )}
          </div>
        </section>

        <section className="tts-sheet-section">
          <div className="tts-sheet-head">
            <h3>音色</h3>
            <button type="button" className="tts-sheet-link" onClick={onRefreshVoices}>刷新</button>
          </div>
          {engine === 'local' && <p className="tts-sheet-note">离线语音包目前只有默认女声；音色列表仅对系统语音生效。</p>}
          {voiceOptions.length > 0 ? (
            <select
              className="tts-sheet-select"
              value={selectedVoice ? voiceKey(selectedVoice) : ''}
              onChange={(e) => onSetVoiceKey(e.target.value || null)}
              aria-label="选择音色"
              disabled={engine === 'local'}
            >
              <option value="">系统默认语音</option>
              {voiceOptions.map((v) => (
                <option key={voiceKey(v)} value={voiceKey(v)}>
                  {v.name} · {v.lang}{v.localService ? ' · 本地' : ' · 网络'}
                </option>
              ))}
            </select>
          ) : (
            <p className="tts-sheet-note">
              {loadingVoices
                ? '正在加载系统语音…'
                : hasAnyVoice
                  ? '没有符合条件的中文语音；仍会用默认语音朗读。'
                  : '系统没有返回语音列表，将使用默认语音朗读。'}
            </p>
          )}
          {hasAnyVoice && (
            <label className="tts-sheet-check">
              <input
                type="checkbox"
                checked={prefs.localOnly}
                onChange={(e) => onSetPrefs({ localOnly: e.target.checked })}
              />
              只列本地语音
            </label>
          )}
          {!prefs.localOnly && (
            <p className="tts-sheet-note">网络语音需要联网，文本会发送给语音提供方。</p>
          )}
        </section>

        <section className="tts-sheet-section">
          <h3>语速</h3>
          <div className="tts-rate-row" role="group" aria-label="语速">
            {RATES.map((r) => (
              <button
                key={r}
                type="button"
                className={prefs.rate === r ? 'tts-chip tts-chip-on' : 'tts-chip'}
                aria-pressed={prefs.rate === r}
                onClick={() => onSetRate(r)}
              >
                {r === 1 ? '1.0x' : `${r}x`}
              </button>
            ))}
          </div>
        </section>

        <section className="tts-sheet-section">
          <h3>睡眠定时</h3>
          <div className="tts-rate-row" role="group" aria-label="睡眠定时">
            {(['off', 15, 30, 45, 60] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={sleepMinutes === m ? 'tts-chip tts-chip-on' : 'tts-chip'}
                aria-pressed={sleepMinutes === m}
                onClick={() => onSetSleepMinutes(m)}
              >
                {m === 'off' ? '关' : `${m} 分`}
              </button>
            ))}
          </div>
        </section>

        <section className="tts-sheet-section">
          <h3>内容</h3>
          <label className="tts-sheet-check">
            <input type="checkbox" checked={prefs.skipCode} onChange={(e) => onSetPrefs({ skipCode: e.target.checked })} />
            跳过代码块
          </label>
          <label className="tts-sheet-check">
            <input type="checkbox" checked={prefs.readTable} onChange={(e) => onSetPrefs({ readTable: e.target.checked })} />
            朗读表格
          </label>
          <label className="tts-sheet-check">
            <input type="checkbox" checked={prefs.keepAwake} onChange={(e) => onSetPrefs({ keepAwake: e.target.checked })} />
            播放时保持屏幕常亮
          </label>
        </section>

        <div className="tts-sheet-actions">
          <button type="button" className="tts-sheet-btn" onClick={onOpenToc}>目录</button>
          <button type="button" className="tts-sheet-btn" onClick={onRestart}>从头朗读</button>
          <button type="button" className="tts-sheet-btn tts-sheet-btn-danger" onClick={onStop}>停止朗读</button>
        </div>
      </div>
    </Drawer>
  );
}
