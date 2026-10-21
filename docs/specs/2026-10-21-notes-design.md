# 文字笔记设计（v1.8）

> 日期：2026-10-21 · 状态：已实现 · 关联：[数据同步设计](2026-10-20-data-sync-design.md)、[跨设备同步配置](../sync-neon-setup.md)
> 范围：阅读页内选中文字 → 新建/编辑/删除笔记；锚点符号；文档笔记列表；`reading.notes` 跨设备同步。

## 1. 目标与非目标

**目标**

1. 选中正文文字后，在自定义菜单里选择「笔记」，输入纯文本并保存。
2. 保存后在锚定文字末尾显示可点击的笔记符号；点击查看/编辑，可删除。
3. 顶栏 `⋯` 菜单增加「笔记」入口，以列表展示当前文档全部笔记；点击条目查看/编辑。
4. 笔记跟随仓库正文改动重新锚定；无法定位时保留记录并在列表中标记「原文已改动」。
5. 笔记通过现有 Neon 同步链路跨设备同步（新增、编辑、删除）。

**非目标**

- 不做富文本 / Markdown 渲染、图片或评论回复；
- 不做笔记全文搜索、跨文档聚合页、导出/导入；
- 不修改笔记锚点（编辑只改正文）；锚点随正文自动重锚；
- 不做手机端文档正文编辑，不写回 GitHub 仓库。

## 2. 数据模型与存储

```ts
interface NoteRecord {
  id: string;          // crypto.randomUUID()
  exact: string;       // 锚定原文
  prefix: string;      // 前 32 字上下文
  suffix: string;      // 后 32 字上下文
  body: string;        // 笔记正文（纯文本，保存时 trim）
  createdAt: number;
  updatedAt: number;   // 同步 LWW 时间戳
}
```

- 存储：IndexedDB `kv.notes` = `{ [docPath]: NoteRecord[] }`；按仓库独立库隔离。
- 新增/编辑：同一事务内写 `kv.notes` + `sync_outbox`，并清同 id 墓碑；时间戳用 `nextUpdatedAt()` 保证本机单调递增。
- 删除：写本地墓碑 `syncTombstones['reading.notes'][id]`，入队 `deleted` 记录；时间戳必须晚于该笔记的 `updatedAt`。
- 读取：`sanitizeNotes()` 丢弃缺 id / exact / body 的记录；缺失时间回退 `createdAt` / 0，未知字段不保留。

## 3. 锚定与渲染

- 复用高亮/搜索的 TextQuote 口径：`buildHaystack()` + `locateAnchor()`；跳过代码、按钮、mermaid 等排除区。
- 笔记符号是 `<button class="note-mark" data-note-id>`，用 `Range.insertNode()` 插到锚点最后一个正文字符之后，**不包裹原文**，不改变正文文本与复制内容。
- 同一文本节点内多处锚点按区间倒序插入；同一终点的多条笔记合并为一个 fragment 一次插入。
- 每次渲染先移除旧符号并 `normalize()` 合并文本节点，再整体重锚，保证新增/编辑/同步后幂等。
- 找不到锚点的孤儿不渲染符号，但记录保留；正文改回后自动恢复。
- 与持久高亮共存：高亮的 haystack 跳过按钮，笔记符号可位于高亮 `<mark>` 内；清除高亮时符号随子节点保留。

## 4. 交互

### 4.1 选区菜单

有选区且不在排除区时，菜单为：`复制 / 笔记 / 高亮·黄 / 高亮·红 /（与已渲染高亮相交时）清除高亮`。
点击「笔记」打开「添加笔记」面板，并清除选区。
代码块等排除区仍只提供「复制」。

### 4.2 笔记面板

- 底部 sheet：引用原文最多 3 行 + 多行 textarea（上限 5000 字）+ 删除（仅编辑）/ 取消 / 保存。
- 空正文不可保存；保存中禁用所有关闭/操作；失败就地提示，不丢失输入。
- Esc / 遮罩 / 关闭按钮关闭；`⌘/Ctrl+Enter` 保存；打开期间锁定背景滚动并聚焦输入框。
- 编辑已有笔记时显示「删除」；确认后删除并关闭。

### 4.3 锚点符号

- 18px 强调蓝实心圆 + 白色便签图标，`aria-label="查看笔记"`，紧贴锚定文字末尾。
- 点击打开「编辑笔记」；如果符号位于链接内，阻止链接导航。
- 键盘可聚焦/Enter 触发（原生 button）。

### 4.4 文档笔记列表

- 顶栏 `⋯` 菜单新增「笔记」项，文案带当前文档笔记数（如「笔记（2）」）。
- 复用底部 Drawer 外壳，标题「笔记」；空态说明如何在选区菜单中添加。
- 条目：原文摘录（2 行）+ 笔记正文（4 行）+ 相对时间；按正文位置排序，孤儿排末尾并显示「原文已改动」。
- 点击条目关闭抽屉并打开编辑面板；可定位时把锚点符号滚到视口中央。

## 5. 同步

- 集合名：`reading.notes`；`record_id = note.id`；`payload = { path, record }`；`updatedAt = note.updatedAt`。
- 注册进 `SYNC_COLLECTIONS`；远端表、后端接口、outbox、同步引擎、reset 流程无需改动。
- `applyRemote`：
  1. 本地墓碑优先：`record.updatedAt <= deletedAt` 直接拒绝（不复活已删除笔记）；
  2. LWW：`remoteWins(remote, local.updatedAt)`；
  3. 删除：移除记录并按需写墓碑；
  4. upsert：校验 payload、按 id 替换（支持路径迁移），清除墓碑；
- `listLocal` / `getLocal` 从 `kv.notes` 读取；推送时由引擎重读当前值。
- `clearBefore(before)`：删除 `updatedAt <= before` 的笔记，供「清除训练数据」之外的 reset 机制复用。
- 不同步：文档正文、笔记锚点之外的任何 UI 状态。

## 6. 边界与错误

- 保存/删除失败：面板显示「保存失败，请重试」/「删除失败，请重试」，输入保留。
- 编辑已被其它设备删除的笔记：提示「这条笔记已不存在」，关闭面板并刷新列表。
- 文档切换：关闭抽屉与面板，旧文档笔记不会套用到新正文。
- 正文改动：能模糊命中则跟随；不能命中则孤儿，列表可见、可编辑/删除。
- 空笔记、超长文本：空不可保存；输入上限 5000 字（远端超长记录仍可读取/编辑）。
- 同步冲突：与现有集合一致，按设备本地时间的 LWW；严重时钟偏差可能导致旧编辑获胜（已知限制）。

## 7. 测试

- 单测：
  - `tests/unit/notes.test.ts`：sanitize、新增/编辑/删除、outbox、无变更不刷新时间戳；
  - `tests/unit/notes-anchor.test.ts`：符号位置、同节点多处、共享锚点、孤儿、幂等、与高亮共存；
  - `tests/unit/sync-collections-reading.test.ts`：list/apply/LWW/墓碑/路径迁移/clearBefore；
  - `tests/unit/sync-engine.test.ts`：集合注册数量与顺序；
  - `tests/unit/selection-menu.test.ts`：菜单项集。
- e2e：`tests/e2e/notes.spec.ts`（创建、编辑、列表、删除）；`tests/e2e/data-sync.spec.ts`（推送与远端恢复）；`tests/e2e/highlight.spec.ts`（菜单项回归）。

## 8. 验收

见 [`docs/acceptance-2026-10-21-notes.md`](../acceptance-2026-10-21-notes.md)。
