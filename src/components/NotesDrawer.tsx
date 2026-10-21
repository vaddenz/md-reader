import type { NoteRecord } from '../data/notes';
import { timeAgo } from '../lib/format';
import Drawer from './Drawer';

interface Props {
  notes: readonly NoteRecord[];
  /** 笔记 id → 正文区间；null 表示尚未完成重锚（不标记孤儿）。 */
  positions: Map<string, { start: number; end: number }> | null;
  onSelect: (note: NoteRecord) => void;
  onClose: () => void;
}

/** 当前文档的笔记列表（⋯ 菜单入口）：按正文位置排序，点击查看/编辑；孤儿排在末尾。 */
export default function NotesDrawer({ notes, positions, onSelect, onClose }: Props) {
  const ordered = [...notes].sort((a, b) => {
    const pa = positions?.get(a.id)?.start;
    const pb = positions?.get(b.id)?.start;
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return a.createdAt - b.createdAt;
  });

  return (
    <Drawer title="笔记" onClose={onClose}>
      {ordered.length === 0 ? (
        <p className="notes-empty">
          这篇文档还没有笔记。选中一段文字后，在菜单里选择「笔记」即可添加。
        </p>
      ) : (
        <ul className="notes-list">
          {ordered.map((note) => {
            const orphan = positions !== null && !positions.has(note.id);
            return (
              <li key={note.id}>
                <button type="button" className="note-item" onClick={() => onSelect(note)}>
                  <span className="note-item-quote">{note.exact}</span>
                  <span className="note-item-body">{note.body}</span>
                  <span className="note-item-meta">
                    <span>{timeAgo(note.updatedAt)}</span>
                    {orphan && <span className="note-orphan">原文已改动</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}
