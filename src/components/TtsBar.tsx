import { useEffect } from 'react';
import type { PlayerState, TtsEngine } from '../tts/types';
import '../styles/tts.css';

interface TtsBarProps {
  state: PlayerState;
  engine: TtsEngine;
  current: number;
  total: number;
  rate: number;
  remainingSeconds: number;
  following: boolean;
  sleepMinutes: number | 'off';
  error?: string;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onOpen: () => void;
  onClose: () => void;
  onResumeFollow: () => void;
}

function formatRemaining(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const m = Math.ceil(seconds / 60);
  return m >= 1 ? `约剩 ${m} 分钟` : '不到 1 分钟';
}

/** 底部朗读控制条。只在朗读会话存在时挂载；关闭即停止并保存位置。 */
export default function TtsBar({
  state,
  engine,
  current,
  total,
  rate,
  remainingSeconds,
  following,
  sleepMinutes,
  error,
  onToggle,
  onPrev,
  onNext,
  onOpen,
  onClose,
  onResumeFollow,
}: TtsBarProps) {
  useEffect(() => {
    document.body.classList.add('tts-bar-visible');
    return () => document.body.classList.remove('tts-bar-visible');
  }, []);

  const playing = state === 'playing';
  const paused = state === 'paused';
  const blocked = state === 'blocked';
  const failed = state === 'error' || state === 'no-voice';
  const ended = state === 'ended';
  const empty = total === 0;

  let status: string;
  if (empty) status = '没有可朗读的正文';
  else if (blocked) status = '点按继续朗读';
  else if (failed) status = error || '朗读失败';
  else if (ended) status = '朗读完毕';
  else if (paused) status = `已暂停 · 第 ${current + 1}/${total} 句`;
  else status = `第 ${current + 1}/${total} 句 · ${formatRemaining(remainingSeconds)}`;

  return (
    <div className="tts-bar" role="region" aria-label="朗读控制">
      <div className="tts-bar-inner">
        <button
          type="button"
          className="tts-play"
          aria-label={playing ? '暂停朗读' : ended ? '重新朗读' : '开始朗读'}
          onClick={onToggle}
          disabled={empty}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <rect x="7" y="5" width="3.4" height="14" rx="1" fill="currentColor" />
              <rect x="13.6" y="5" width="3.4" height="14" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M8 5.5v13l10-6.5z" fill="currentColor" />
            </svg>
          )}
        </button>

        <div className="tts-status">
          <span className="tts-status-main">{status}</span>
          <span className="tts-status-sub">
            {engine === 'local' ? '离线包' : '系统语音'} · {rate.toFixed(2).replace(/0$/, '')}x
            {sleepMinutes !== 'off' ? ` · ${sleepMinutes} 分钟后停` : ''}
            {!following ? ' · 未跟随' : ''}
          </span>
        </div>

        <div className="tts-actions">
          {!following && (
            <button type="button" className="tts-icon-btn tts-locate" aria-label="回到当前句" onClick={onResumeFollow}>
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <button type="button" className="tts-icon-btn tts-prev" aria-label="上一句" onClick={onPrev} disabled={current <= 0 || empty}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M7 5v14M19 5l-8 7 8 7z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" className="tts-icon-btn tts-next" aria-label="下一句" onClick={onNext} disabled={current >= total - 1 || empty}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M17 5v14M5 5l8 7-8 7z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" className="tts-icon-btn tts-more" aria-label="朗读设置" onClick={onOpen}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M5 8h14M5 12h14M5 16h9" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className="tts-icon-btn tts-close" aria-label="关闭朗读" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <div className="tts-progress" aria-hidden="true">
        <i style={{ width: total > 0 ? `${((current + 1) / total) * 100}%` : '0%' }} />
      </div>
      <div className="sr-only" aria-live="polite">
        {status}
      </div>
    </div>
  );
}
