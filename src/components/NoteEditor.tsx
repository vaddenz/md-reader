import { useEffect, useRef, useState } from 'react';
import '../styles/notes.css';

interface Props {
  mode: 'create' | 'edit';
  /** 被锚定的原文；为空时（理论上不会发生）不显示引用区。 */
  anchor: string;
  initialBody?: string;
  onSave: (body: string) => Promise<void>;
  /** 仅编辑已有笔记时提供。 */
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

/** 笔记输入/编辑面板：底部 sheet，移动端优先；Esc/遮罩关闭，⌘/Ctrl+Enter 保存。 */
export default function NoteEditor({ mode, anchor, initialBody = '', onSave, onDelete, onClose }: Props) {
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const busy = saving || deleting;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    textRef.current?.focus({ preventScroll: true });
    // 光标放到已有正文末尾，方便继续补充。
    const len = textRef.current?.value.length ?? 0;
    textRef.current?.setSelectionRange(len, len);
    return () => {
      document.body.style.overflow = prevOverflow;
      prev?.focus({ preventScroll: true });
    };
  }, []);

  /** 关闭前保护未保存输入：有改动时二次确认（保存/删除成功由父组件直接卸载）。 */
  const requestClose = () => {
    if (busy) return;
    if (body.trim() !== initialBody.trim() && !window.confirm('放弃未保存的笔记？')) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, body, initialBody, onClose]);

  const save = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(text);
    } catch {
      setError('保存失败，请重试');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!onDelete || busy) return;
    if (!window.confirm('删除这条笔记？')) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch {
      setError('删除失败，请重试');
      setDeleting(false);
    }
  };

  return (
    <div className="note-overlay" onClick={requestClose}>
      <div
        ref={panelRef}
        className="note-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'create' ? '添加笔记' : '编辑笔记'}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="note-head">
          <h2 className="note-title">{mode === 'create' ? '添加笔记' : '编辑笔记'}</h2>
          <button type="button" className="note-close" aria-label="关闭笔记" onClick={requestClose} disabled={busy}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {anchor && (
          <blockquote className="note-quote" title={anchor}>
            {anchor}
          </blockquote>
        )}

        <textarea
          ref={textRef}
          className="note-input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="写下你的想法…"
          rows={6}
          maxLength={5000}
          aria-label="笔记内容"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            }
          }}
        />

        {error && <p role="alert" className="note-error">{error}</p>}

        <div className="note-actions">
          {onDelete && (
            <button type="button" className="note-btn note-btn-danger" onClick={() => void remove()} disabled={busy}>
              {deleting ? '删除中…' : '删除'}
            </button>
          )}
          <button type="button" className="note-btn" onClick={requestClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="note-btn note-btn-primary"
            onClick={() => void save()}
            disabled={busy || !body.trim()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
