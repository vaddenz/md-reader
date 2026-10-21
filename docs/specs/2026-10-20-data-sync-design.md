# md-reader v1.7 · 跨设备数据同步设计（Design Spec）

> 日期：2026-10-20 · 状态：待用户评审
> 关系：本文件是 v1.6.1 之上的**增量设计**，只定义「跨设备数据同步」特性；v1.0 / v1.1 / v1.3 设计在未被本文件覆盖的范围内继续有效。
> 目标版本：v1.7.0。
> 分支 / 工作区：`data-sync`。

## 1. 概述

### 1.1 本次范围

1. **可扩展的同步后端抽象**：一套通用的「记录级」远端存储接口 + 后端注册表；新增后端只需实现接口并注册，不需要改业务数据层。
2. **可扩展的本地集合适配器**：阅读进度、高亮、收藏、记忆 SRS、训练记录、题库偏好各自一个适配器；笔记（notes）只预留扩展点，本期不做 UI。
3. **Neon Postgres Data API 后端**：使用用户自备的 Data API URL + JWT，读写单张通用记录表；提供建表 / RLS / 条件 upsert RPC 的初始化 SQL。
4. **多仓库同步**：一次同步遍历本机已配置的全部 GitHub 仓库，各仓库数据按 `owner/repo@branch` 分域；不需要切换到某个仓库才能同步它（自动或手动发起都一样）。
5. **自动 + 手动触发（自动默认关闭）**：启动、联网恢复、页面隐藏/退出、数据变更后合并推送，另加「立即同步」；设置页提供「自动同步」开关，**默认关闭**，关闭时只能手动同步，开启后才自动发起上述同步。
6. **设置页接入**：新增「设置 › 跨设备同步」页，包含后端配置、连接测试、状态、初始化说明与危险操作。
7. **配套改动**：IndexedDB schema v3、收藏存储迁移、`MemorySelection.updatedAt`、PRODUCT.md / README / DESIGN.md 文案同步。

### 1.2 已确认的决策

| # | 决策 |
| --- | --- |
| 1 | 鉴权采用**长期 JWT**（用户自备 JWKS provider，或使用仓库附带的本地 JWT 生成脚本）；不做登录 UI，不做 15 分钟 token 自动续期 |
| 2 | 首批同步：阅读进度、文本高亮、收藏、记忆 SRS、训练记录、题库偏好；笔记预留 |
| 3 | 不同步：正文、GitHub Token、AI Key/模型配置、当前训练会话、打开的多标签、阅读外观与全局设置 |
| 4 | 多仓库全部同步（自动或手动）；各仓库数据独立，scope = `owner/repo@branch` |
| 5 | 同步分「自动同步」与「手动同步」两种模式；**自动同步默认关闭**，可随时开启；关闭时只有点击「立即同步」才会发起同步（用于控制请求 / 流量成本） |
| 6 | 远端采用通用记录表，不为每种数据类型建表；加数据类型不改远端 schema |
| 7 | 冲突策略：逐记录 LWW（最后写入获胜）；服务端用 `(updatedAt, deviceId)` 条件写，客户端拉取时远端时间戳 `>=` 本地即应用（平局由远端/服务端获胜） |
| 8 | 删除使用 tombstone；「清除训练数据」使用集合级 reset 标记，避免另一台设备把旧记录推回来 |
| 9 | 后端实现使用原生 `fetch`，不新增运行时依赖 |
| 10 | 同步配置与 JWT 存 localStorage（与现有 GitHub Token 同级）；outbox 存每个仓库自己的 IndexedDB |
| 11 | 同步页文案统一用「跨设备同步」；现有 GitHub 内容同步仍叫「同步 / 更新目录」，两者不混用 |

## 2. 全局约束与非目标

### 2.1 约束

- 技术栈不变：React 18 + TS + Vite PWA + IndexedDB + hash 路由；不新增运行时依赖。
- CSP 已是 `connect-src 'self' https:`，Neon Data API 直连无需再改。
- 现有 200+ 单测与 25 e2e 必须全绿；新功能按同口径补测。
- 阅读页 / 搜索 / 现有 GitHub 内容同步行为不变；同步失败不得阻塞阅读或写坏本地数据。
- 离线优先：未配置、离线或后端不可用时，所有本地功能照常；变更留在 outbox，联网后重试。
- 隐私边界修订（PRODUCT.md 原则 1）：正文、GitHub Token、AI Key 仍不出本机；**启用跨设备同步后**，阅读进度、高亮、收藏、记忆 SRS / 训练记录 / 题库偏好会发送到用户自备的 Neon Data API。设置页与 README 必须明确写出这一点。
- 单用户、无账号体系；JWT 的 `sub` 是唯一身份，RLS 只允许本人读写。

### 2.2 非目标

- 不做实时推送 / WebSocket / Supabase Realtime 一类能力。
- 不做 Service Worker 后台同步；页面关闭后的最后一批同步是 best-effort。
- 不做冲突人工合并 UI；LWW 直接裁决。
- 不做笔记编辑 UI；只保证新增 notes collection 时不需要改远端表结构。
- 不做同步数据的端到端加密；JWT 就是数据访问凭据，服务端（Neon）可见明文。
- 不做多用户共享 / 团队空间。

## 3. 架构

### 3.1 模块划分

```
src/sync/
  types.ts               SyncBackend / RemoteRecord / SyncCollection / BackendField
  registry.ts            后端注册表：type → SyncBackendDefinition
  config.ts              localStorage 配置 + 校验 + 默认值
  state.ts               全局同步状态（lastSyncAt / error / 每仓库 cursor）
  device.ts              稳定设备 ID（LWW 平局裁决）
  outbox.ts              每仓库 IndexedDB 变更队列；原子写入辅助
  engine.ts              遍历全部仓库：拉取 → 合并 → 推送
  backends/neon.ts       Neon Data API 实现
  collections/           progress / highlights / favorites / memorySrs / memoryAttempts / memorySelection
  DataSyncContext.tsx    React Provider + useDataSync()
```

`src/data/sync.ts` 是现有 GitHub **内容同步**，与本特性无关；本特性统一放在 `src/sync/`，UI 称「跨设备同步」。

### 3.2 核心接口

```ts
// types.ts
export interface BackendField {
  key: string;
  label: string;
  type: 'url' | 'password' | 'text';
  placeholder?: string;
  help?: string;
  required: boolean;
}

export interface SyncBackendDefinition {
  type: string;                 // 'neon'
  label: string;
  description: string;
  fields: BackendField[];
  create(values: Readonly<Record<string, string>>): SyncBackend;
  validate?(values: Readonly<Record<string, string>>): string | null;
}

export interface TestResult {
  /** 非阻断性提示，例如 JWT 临近过期。 */
  warning?: string;
}

export interface SyncBackend {
  /** 检查 URL / JWT / 表 / RPC 是否可用；失败抛 SyncError。 */
  test(signal?: AbortSignal): Promise<TestResult>;
  /** 拉取 scope 下 server_updated_at >= since 的全部记录（含分页），按 server_updated_at 升序。 */
  pull(scope: string, since: number, signal?: AbortSignal): Promise<RemoteRecord[]>;
  /** 条件 upsert：只有更新的记录才允许覆盖远端；分批由调用方负责。 */
  push(records: readonly SyncRecord[], signal?: AbortSignal): Promise<void>;
}

export interface SyncRecord {
  scope: string;
  collection: string;
  recordId: string;
  payload: unknown;             // tombstone 为 null
  updatedAt: number;            // 客户端语义时间（ms）
  deleted: boolean;
  deviceId: string;
}

export interface RemoteRecord extends SyncRecord {
  serverUpdatedAt: number;      // 后端返回的服务器时间（ms），拉取游标用
}

export interface LocalRecord {
  recordId: string;
  updatedAt: number;
  deleted: boolean;
  payload: unknown | null;
}

export interface SyncCollection {
  name: string;                 // 'reading.progress' 等
  label: string;
  listLocal(db: RepoDb): Promise<LocalRecord[]>;
  getLocal(db: RepoDb, recordId: string): Promise<LocalRecord | undefined>;
  /** 应用一条远端记录；返回是否真的改变了本地数据（用于统计与事件）。 */
  applyRemote(db: RepoDb, record: RemoteRecord): Promise<boolean>;
  clearBefore?(db: RepoDb, before: number): Promise<void>;
}
```

`RepoDb` 是对某个仓库 `IDBPDatabase` 的轻量包装，提供 `kvGet / kvSet / transaction / close`，不依赖全局「当前仓库」作用域。这样同步引擎可以打开非当前仓库的库。

### 3.3 后端注册

`backends/neon.ts` 导出 `neonDefinition`；`registry.ts` 静态注册。设置页只依赖 `BackendField[]` 渲染表单，因此新增后端 = 新建一个定义文件 + 在注册表加一行；不需要改设置页 JSX 的业务逻辑。

注册表同时提供：
- `listSyncBackends(): SyncBackendDefinition[]`
- `getSyncBackend(type: string): SyncBackendDefinition | undefined`
- `createSyncBackend(config: SyncConfig): SyncBackend`（校验配置后调用 definition.create）

## 4. 远端数据模型（Neon）

### 4.1 通用记录表

一张表承载所有数据类型：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | `text` | 默认 `auth.user_id()`，来自 JWT `sub` |
| `scope` | `text` | `owner/repo@branch` |
| `collection` | `text` | `reading.progress` 等 |
| `record_id` | `text` | 文档路径 / 高亮 id / qid / attemptKey / `selection` |
| `payload` | `jsonb` | 业务数据；tombstone 为 null |
| `updated_at` | `double precision` | 客户端语义时间（ms） |
| `deleted` | `boolean` | tombstone |
| `device_id` | `text` | 写入设备 ID，平局裁决 |
| `server_updated_at` | `timestamptz` | 服务器接收时间，拉取游标 |

主键：`(user_id, scope, collection, record_id)`。索引：`(user_id, scope, server_updated_at)`。

### 4.2 条件 upsert

`sync_upsert(p_records jsonb)` 在 Postgres 内做条件更新：

- 插入时 `user_id = current_setting('request.jwt.claims', true)::jsonb->>'sub'`（Data API 会把 JWT claims 放进 `request.jwt.claims`；这样 RPC 不依赖 `authenticated` 对 `auth` schema 的 USAGE 权限）；
- 冲突时只有当
  `(excluded.updated_at, excluded.device_id)`
  **严格大于**
  `(existing.updated_at, existing.device_id)`
  才覆盖；否则保持远端不变。
- 覆盖时刷新 `server_updated_at = now()`；被拒绝的旧记录不刷新，避免拉取游标噪声。

这样即使客户端在拉取后、推送前发生了另一台设备的更新，旧写入也不会覆盖新数据。

### 4.3 RLS

```sql
alter table public.sync_records enable row level security;

create policy sync_records_own on public.sync_records
for all to authenticated
using (auth.user_id() = user_id)
with check (auth.user_id() = user_id);
```

- 不向 `anon` 授权；匿名请求不能读写。
- 用户必须在 Neon 执行初始化 SQL；应用内提供可复制的完整 SQL，同时 `docs/sync-neon-setup.md` 给出步骤。
- 如果表不存在 / RLS 未配置 / RPC 不存在，`test()` 与首次同步给出明确错误，不静默失败。

完整 SQL 见附录 A。

## 5. 同步语义

### 5.1 时间戳与 LWW

每条本地记录都有一个语义时间戳 `updatedAt`：

| collection | record_id | updatedAt 来源 |
| --- | --- | --- |
| `reading.progress` | 文档路径 | `ProgressRecord.updatedAt` |
| `reading.highlights` | 高亮 `id` | `HighlightRecord.createdAt`（本期无编辑，创建时间即版本） |
| `reading.favorites` | 文档路径 | `addedAt`；删除时用删除时间 |
| `memory.srs` | `qid` | `SrsState.lastAt` |
| `memory.attempts` | `attemptKey(qid|ts|mode)` | `MemoryAttempt.ts` |
| `memory.selection` | 固定 `selection` | 新增 `MemorySelection.updatedAt` |
| `notes`（预留） | 以后定义 | 以后定义 |

比较规则：

- **服务端**（条件 upsert）：`(updatedAt, deviceId)` 字典序大者胜；相同则保持远端不变。
- **客户端**（拉取合并）：`remote.updatedAt > local.updatedAt` 时应用远端；`===` 时也应用远端（平局由服务端获胜），从而与远端最终状态收敛；`<` 时保留本地。客户端不需要在本地保存 `deviceId`。
- 同一设备同一毫秒的两次写：用 `nextUpdatedAt()` 保证严格递增，不会走平局分支。

为避免同一设备同一毫秒内的两次写互相覆盖，进度、收藏、题库偏好、删除 tombstone、reset 标记等使用 `nextUpdatedAt()` 生成**单调递增**时间戳：

```ts
let last = 0;
/** atLeast：被修改记录的当前 updatedAt；保证本地编辑/删除严格新于原版本。 */
export function nextUpdatedAt(now = Date.now(), atLeast = 0): number {
  last = Math.max(now, last + 1, atLeast + 1);
  return last;
}
```

更新已有记录（进度、收藏、题库偏好、高亮删除）时传入 `existing.updatedAt` 作为 `atLeast`，避免设备时钟回拨导致编辑被认为更旧。SRS / 训练记录保留语义时间（`lastAt` / `ts`），不同记录键之间不会互相覆盖；同一记录键同一毫秒的重复作答按现有 `attemptKey` 去重口径处理。

时间戳来自各设备本地时钟；不保证设备时钟精确同步。个人多设备场景接受「时钟偏差导致较旧编辑获胜」的风险；不引入 HLC / 服务器时间回写，避免复杂度。README / 设置页说明这一点。

### 5.2 删除与 tombstone

- 进度：没有显式删除 UI；如果某文档进度记录被清除（未来功能），写 tombstone。
- 高亮：`removeHighlights` 对每个实际存在的 id 写 `deleted=true`，`updatedAt=Date.now()`。
- 收藏：`toggleFavorite` 移除时写 tombstone，`updatedAt=Date.now()`。
- SRS：本期没有单条删除 UI；reset 标记覆盖。
- 训练记录：本期没有单条删除 UI；reset 标记覆盖。
- 题库偏好：保存即 upsert；无删除 UI。

tombstone 永远保留在远端（个人数据量小），保证新设备首次同步也能学到删除。未来可加清理策略，不在本期。

除远端 tombstone 外，每个仓库库还在本地维护删除标记：

```
kv.syncTombstones = Record<collection, Record<recordId, deletedAt>>
```

- 本地删除（删除高亮、取消收藏）在写数据 + outbox 的**同一事务**里写入 `syncTombstones`；应用远端 tombstone 时也记录其 `updatedAt`。
- 应用可能复活已删记录的远端 upsert 前先查本地墓碑（进度 / 高亮 / 收藏 / SRS / 训练记录）：`record.updatedAt <= deletedAt` 的 upsert 直接忽略，避免「本机刚删除、尚未推送」时被拉取到的陈旧远端记录复活。题库偏好没有删除语义，不写墓碑。
- 本地重新编辑同一记录（新增高亮、重新收藏、写进度、重新作答、导入）时清除对应墓碑。
- 墓碑只存在本机 IndexedDB（`kv.syncTombstones`，按仓库独立），不上传、不参与 LWW；远端仍以 `deleted=true` 的普通记录表达删除。

### 5.3 集合级 reset（清除训练数据）

`clearTrainingData()` 清空本机 `mem_srs` / `mem_attempts` 后，同时更新本机 `kv.syncReset` 并写入两个特殊记录。`now` 用 `nextUpdatedAt(Date.now(), max(被清记录的 lastAt / ts))` 生成，确保 reset 时间不早于任何旧记录：

```
collection = 'memory.srs' | 'memory.attempts'
record_id  = '__reset__'
deleted    = true
updated_at = now
payload    = { before: now }
```

应用远端 reset 时：

1. 记录 `syncReset[collection] = max(existing, before)`；
2. 删除本地该 collection 中 `updatedAt <= before` 的记录；
3. 删除 outbox 中该 collection 下 `updatedAt <= before` 的普通条目（保留 reset 自身）；
4. 之后拉取 / 首次 seed 时，忽略 `updatedAt <= syncReset[collection]` 的普通记录。

这样设备 A 清除后，设备 B 拉取 reset 会清掉旧数据；B 之后即使带着旧 outbox 推送，也会被 A/B 的 reset 过滤，不会复活。reset 标记本身幂等，重复应用无副作用。

### 5.4 合并流程

对每个仓库 scope：

1. **拉取远端**：`pull(scope, cursor)`；`cursor` 初始 0，之后为上次拉到的最大 `serverUpdatedAt`（inclusive，边界重复拉取由幂等合并吸收）。
2. **应用 reset**：先扫描本批记录中的 `__reset__`，更新 `syncReset` 并清理本地旧数据 / outbox。
3. **首次 seed（按 collection）**：对每个尚未出现在 `kv.syncSeededCollections` 中的 collection，枚举其本地记录（跳过 reset 之前的），批量写入 outbox，然后把该 collection 加入 `syncSeededCollections`。这样以后新增 notes 等 collection 时，只补 seed 新集合，不需要重扫全部数据。
4. **应用普通远端记录**：跳过 `updatedAt <= syncReset[collection]` 的记录；按 §5.1 比较本地记录，远端更新则写入本地（upsert 或删除）。
5. **推送 outbox**：分批调用 `backend.push`；每批成功后，按 `rev` 精确删除已推送条目（若推送期间条目被更新，保留新条目）。
6. **更新状态**：cursor、lastSyncAt、每仓库结果、错误清空。

拉取在 seed 之前，是为了先获知远端 reset，避免把本地旧数据 seed 进去再推回远端；seed 在普通远端应用之前，避免把刚拉下来的远端记录当成「本地变更」再推回去。

## 6. 本地变更追踪（outbox）

### 6.1 schema v3

`SCHEMA_VER` 2 → 3，仅新增 object store，不改旧 store：

```ts
// sync_outbox, keyPath: 'id'
interface OutboxEntry {
  id: string;            // `${collection}\u0000${recordId}`
  collection: string;
  recordId: string;
  updatedAt: number;
  deleted: boolean;
  rev: string;           // 每次写入生成新随机值，用于并发安全删除
  payload?: unknown;     // 仅 reset 等需要显式 payload 的条目
}
```

同时给 `sync_outbox` 建 `collection` 索引，便于 reset 清理。

### 6.2 原子写入

数据写入与 outbox 入队必须在**同一个 IndexedDB 事务**里完成，避免「数据已保存但变更没入队」导致永远不同步。改造以下写入口：

- `saveProgress`（`kv` + `sync_outbox`）
- `toggleFavorite`（`kv` + `sync_outbox`）
- `addHighlight` / `removeHighlights`（`kv` + `sync_outbox`）
- `putSrs`（`mem_srs` + `sync_outbox`）
- `appendAttempt`（`mem_attempts` + `sync_outbox`）
- `saveSelection`（`kv` + `sync_outbox`）
- `importHighlights`（`kv` + `sync_outbox`）：导入成功的记录逐条入队
- `importMemory`（`mem_srs` + `mem_attempts` + `sync_outbox`）：导入成功的 SRS / attempts 逐条入队
- `clearTrainingData`（`mem_srs` + `mem_attempts` + `kv` + `sync_outbox`）

统一使用 `serialize()` 串行化读-改-写。`enqueueChange` 辅助函数接收一个已包含 `sync_outbox` 的事务，写入/覆盖对应条目并刷新 `rev`。

### 6.3 入队时机

- 写数据成功后立即入队；同一记录多次写入只保留一条（按 `id` upsert），`updatedAt` 取最新。
- 远端应用写入**不入队**（否则会把刚拉下来的数据再推回去）。
- 入队所在事务**提交成功后**才派发 `window` 事件 `mdreader:sync-dirty`：写入口统一用 `commitWithNotify(tx)`，即 `await tx.done` 后再派发。这样同步不会抢在数据/outbox 落盘之前读取旧状态。`DataSyncProvider` 监听并做延迟合并同步；事件不携带敏感数据。
- 同步关闭时仍然入队，保证重新启用后能补推。

## 7. 集合适配器

所有适配器都在 `src/sync/collections/`，通过 `collections/index.ts` 注册。新增数据类型只需实现 `SyncCollection` 并注册。

### 7.1 阅读进度 `reading.progress`

- 本地：`kv.progress` = `Record<path, ProgressRecord>`。
- `listLocal`：每个 path 一条，`updatedAt = rec.updatedAt`，payload = `{ ratio, headingId?, updatedAt }`。
- `applyRemote`：读 map；远端更新则 upsert；`deleted` 则删除该 path；保留 map 其他项。

### 7.2 文本高亮 `reading.highlights`

- 本地：`kv.highlights` = `Record<path, HighlightRecord[]>`。
- record_id = `HighlightRecord.id`；payload = `{ path, record }`。
- `updatedAt = record.createdAt`（本期无编辑）。
- `applyRemote`：按 id 在对应 path 中 upsert / 删除；如果 path 变化（理论上不会），先删旧 path 再插新 path。
- 删除 tombstone 的 `payload = null`，应用时从所有 path 中移除该 id。

### 7.3 收藏 `reading.favorites`

本地存储迁移为 V2：

```ts
// kv.favoritesV2 = Record<path, { addedAt: number }>
```

- 首次读取时若 `favoritesV2` 不存在、旧 `favorites`（string[]）存在，则按原数组顺序迁移：`addedAt = index`；写 V2 后删除旧 key。迁移在 `serialize()` 内完成。
- `getFavorites()` 对外仍返回 `string[]`，按 `addedAt` 升序、再按 path 字典序稳定排序，保持「先收藏在前」的现有观感。
- `toggleFavorite`：新增 `addedAt = Date.now()`；移除写 tombstone。
- 远端 payload = `{ addedAt }` 或 null；record_id = path。

### 7.4 记忆 SRS `memory.srs`

- 本地：`mem_srs` store，key = `qid`，value = `SrsState`。
- `updatedAt = lastAt`；payload = 完整 `SrsState`。
- `applyRemote`：读当前 qid，远端更新则 `put` / `delete`。
- reset：`clearBefore` 删除 `lastAt <= before`。

### 7.5 训练记录 `memory.attempts`

- 本地：`mem_attempts` store，自增 id；稳定键 `attemptKey = qid|ts|mode`。
- `listLocal`：getAll → 每条 `recordId = attemptKey(a)`，`updatedAt = a.ts`，payload = 去掉本地 `id` 的 attempt。
- `applyRemote`：
  - 先按 key 建索引；若远端 deleted，删除对应本地记录；
  - 若不存在且是 upsert，`add`（不写 id，让自增分配）；
  - 若已存在，视为同一条，跳过（时间戳相同；内容差异不做覆盖）。
- reset：`clearBefore` 删除 `ts <= before`。
- 同一 qid 同一毫秒同 mode 的两次作答在现有去重口径下已视为同一条；跨设备碰撞概率可忽略，沿用该口径。

### 7.6 题库偏好 `memory.selection`

- 本地：`kv.memSelection` = `MemorySelection`；新增可选 `updatedAt?: number`。
- 只同步 `banks` + `filters` + `updatedAt`；**不同步** `sessionSize` / `newPerDay`，避免一个仓库的题量设置影响其他仓库的全局训练设置。
- `applyRemote`：读 raw `memSelection`，保留本地 `sessionSize/newPerDay`，只替换 `banks/filters`，写入远端 `updatedAt`。
- `saveSelection` 写入时先读取旧 raw selection；只有 `banks` / `filters` 实际变化时才刷新 `updatedAt` 并入队。仅修改 `sessionSize/newPerDay`（设置页的训练设置）不触发同步，避免把另一台设备较新的题库选择覆盖掉。
- 旧数据没有 `updatedAt` 时按 0 处理，首次题库/筛选变化后自然获得时间戳。
- `clearBefore`：`updatedAt <= before` 时删除。

### 7.7 笔记（预留，不实现）

> 2026-10-21 更新：已按本节扩展点实现（`reading.notes`），见 [`2026-10-21-notes-design.md`](2026-10-21-notes-design.md)。以下为当时的预留设计，保留作历史记录。

本期不创建 notes 适配器。未来新增时：

1. 在 `src/data/` 定义笔记存储与 sanitize；
2. 在 `src/sync/collections/` 新增适配器（record_id = note id，payload 自定，updatedAt = note.updatedAt）；
3. 在 `collections/index.ts` 注册。

远端表、后端接口、outbox、同步引擎均不需要改。

## 8. 同步引擎

### 8.1 同步范围

`loadRepoState()` 给出 `owner` + `repos[]`。对每个 repo：

- `scope = `${owner.toLowerCase()}/${repo.repo.toLowerCase()}@${repo.branch}``（GitHub owner/repo 不区分大小写，branch 区分大小写）
- `dbName = repoDbName(repo.id)`（默认仓库 `mdreader`，其余 `mdreader-<id>`）
- 当前仓库优先同步，其余仓库随后顺序同步；全部顺序执行，避免同时打开多个连接和并发网络请求。
- 每个仓库库记录 `kv.syncScope`；与当前 scope 不一致（库被自愈重建、仓库改名、删除后重加）时，本次把 cursor 视为 0 并重新 seed，避免只拉到增量而漏掉远端全量数据。`syncScope` 只在**拉取并成功应用远端记录后**落盘；拉取/应用失败时下次仍会从 0 重试。

打开仓库库：
- 当前仓库复用全局 `openDb()` 连接（不关闭）；
- 非当前仓库使用 `openSyncDb(dbName)`：与 `openDb()` 相同的 schema upgrade，但不做「失败删库重建」自愈；
- 非当前仓库每次同步结束关闭连接；
- 被旧页面阻塞时（6 秒超时）跳过该仓库并在结果里标记 `blocked`，不删除数据库、不影响其他仓库。

### 8.2 单仓库流程

```
syncRepo(backend, repo, state):
  1. open db
  2. scopeChanged = kv.syncScope !== scope
     若 scopeChanged：cursor = 0；seeded = ∅（不要立刻写 kv.syncScope，拉取失败时下次仍要从 0 重试）
  3. resets = kv.syncReset || {}
  4. remote = await backend.pull(scope, cursor)
  5. resets = applyResetRecords(db, remote)
  6. for c of collections not in seeded:
       seedCollectionOutbox(db, c, resets); seeded.add(c)
     若 scopeChanged：kv.syncSeededCollections = [...seeded]
  7. for r of remote where !isReset(r):
       if r.updatedAt <= (resets[r.collection] ?? 0) continue
       collectionFor(r.collection)?.applyRemote(db, r)
  8. nextCursor = max(cursor, max(remote.serverUpdatedAt))
     持久化 cursor：即使后续推送失败，已成功应用的拉取也不重复拉取
     若 scopeChanged：kv.syncScope = scope
  9. entries = readOutbox(db)
  10. for batch of entries:
       records = materialize(batch, db)   // 从本地读 payload；deleted → null；reset → entry.payload
       await backend.push(records)
       for e of batch: deleteOutboxIfRev(db, e.id, e.rev)
  11. update lastSyncAt / result
  12. close db（非当前仓库）
```

`materialize` 对普通 upsert 条目重新读取本地当前值：如果本地记录在 seed 后又被远端应用更新，payload 取最新值；如果本地记录已不存在，则按 tombstone 推送，`updatedAt` 用 entry.updatedAt。

### 8.3 并发与重入

- 模块级 `activeSync: Promise<SyncSummary> | null`；`syncNow()` 返回现有 Promise，不并发执行。
- 同步期间新的脏事件只标记 `dirty = true`；当前轮结束后若仍 dirty，再调度一轮（避免无限循环：每轮结束检查一次）。
- 同一仓库的数据写入由 `serialize()` 串行化；同步应用远端写入也走 `serialize()`（当前仓库）或直接事务（非当前仓库）。
- 推送后删除 outbox 条目必须校验 `rev`：若条目在推送期间被用户写更新，保留新条目。

### 8.4 自动触发与「自动同步」开关

`SyncConfig` 增加 `autoSync: boolean`（**默认 `false`**）。首次保存配置后处于「仅手动」状态，设置页明确提示点击「立即同步」；用户主动打开开关后才进入自动模式。`DataSyncProvider` 在应用根部挂载（`App` 内、`RouterProvider` 外层）：

**自动同步开启（`enabled && autoSync`）时：**

- 启动：延迟 3 秒执行首次同步（不阻塞首屏）。
- `online`：立即执行。
- `visibilitychange` → hidden：触发一次（best-effort）；visible 且距上次同步 > 5 分钟：触发一次。
- `mdreader:sync-dirty`：10 秒 trailing debounce；若持续有变更，最多 60 秒强制触发一次。
- 保存配置 / 重新开启自动同步：延迟 3 秒执行一次。

**自动同步关闭（`autoSync=false`）时：**

- 上述所有自动触发全部跳过；关闭状态下，除手动点击「立即同步」和把「自动同步」开关重新打开外，不发起网络请求。
- 脏事件仍然会写 outbox；Provider 在 dirty 后延迟 1 秒重新统计「待同步条数」（只读 IndexedDB，不发网络），不调度同步。
- 只有用户点击「立即同步」才执行同步（`enabled && configured` 为前提）。
- 关闭自动同步不影响手动同步的拉取 + 推送语义；也不影响 `enabled`（停用）和配置清除。

**手动「立即同步」：** 不受 `autoSync` 影响，不等待 debounce，直接执行。离线 / 未配置 / `enabled=false` 时禁用。

### 8.5 同步结果

```ts
interface RepoResult {
  repoId: string;
  scope: string;
  pulled: number;
  applied: number;
  pushed: number;
  skipped?: 'blocked' | 'offline';
  error?: string; // 已分类的中文短句，不含 token
}
interface SyncSummary {
  startedAt: number;
  finishedAt: number;
  repos: RepoResult[];
  pulled: number;
  applied: number;
  pushed: number;
}
```

设置页展示总数与每仓库结果；首页不新增入口，避免与 GitHub 内容同步混淆。

### 8.6 UI 刷新事件

同步对当前仓库 `applied > 0` 时派发：

```ts
window.dispatchEvent(new CustomEvent('mdreader:sync-applied', {
  detail: { scope },
}));
```

- `HomePage`：重新读取最近阅读 / 收藏 / 进度环。
- `DocPage`：若 `scope` 对应当前仓库，重新读取并渲染高亮；**不自动滚动**阅读位置。
- 记忆页：训练中不打断当前会话；下次进入页面时读取最新 SRS / 记录。若不在训练中，可在事件后刷新概览。
- 事件只携带 scope，不含任何用户数据。

## 9. Neon Data API 后端

### 9.1 配置字段

`neon` definition：

| key | label | type | required | 说明 |
| --- | --- | --- | --- | --- |
| `endpoint` | 接口地址 | url | 是 | 形如 `https://ep-xxx.apirest.region.aws.neon.tech/neondb/rest/v1`；保存时去尾部 `/` |
| `token` | JWT | password | 是 | `Authorization: Bearer <token>`，只在请求头中出现 |

### 9.2 请求

- `test()`：
  1. 客户端解析 JWT payload（不验签），确认 `sub` 非空且 `role` 为 `authenticated`（Data API 默认用 `.role` 选择数据库角色；缺少 role 会导致写入 403）；`exp` 已过期 → `auth` 错误并阻止测试；`exp` 在 30 天内 → 测试继续但返回到期警告。JWT 不是三段式或无法解析 → `config` 错误。
  2. `GET {endpoint}/sync_records?select=scope&limit=1`（读权限 + 表存在）。
  3. `POST {endpoint}/rpc/sync_upsert`，写入一条 `collection='__probe__'`、`record_id='probe'`、`payload=null`、`updated_at=0`、`deleted=true`、`device_id='__probe__'` 的探测记录（写权限 + RLS `with check`）。
  4. `DELETE {endpoint}/sync_records?scope=eq.__probe__&collection=eq.__probe__&record_id=eq.probe` 清理探测记录；删除失败不影响连接判定，残留行不会被集合适配器处理。
  5. 全部成功 → 连接可用；401/403 → 鉴权失败；404 → 表/RPC 不存在；其他 → 服务端错误。
- `pull(scope, since)`：
  - `GET {endpoint}/sync_records?select=collection,record_id,payload,updated_at,deleted,device_id,server_updated_at&scope=eq.<encoded>&server_updated_at=gte.<iso>&order=server_updated_at.asc,collection.asc,record_id.asc&limit=500&offset=<n>`
  - 循环分页直到返回不足 500 条；解析 `server_updated_at` 为 ms。
  - `since=0` 时省略时间过滤。
- `push(records)`：
  - `POST {endpoint}/rpc/sync_upsert`，body `{ "p_records": [...] }`；每条含 `scope, collection, record_id, payload, updated_at, deleted, device_id`。
  - 发送前按 `(scope, collection, record_id)` 去重（同一批里同一行重复会让 Postgres `ON CONFLICT DO UPDATE` 报错）；outbox 本身已按该键去重，这里是防御性处理。
  - 调用方按 200 条分批；后端实现不再嵌套分批。
- 超时：单请求 30 秒；支持 `AbortSignal`。
- 错误分类：`config | auth | notfound | network | server | parse`；`fetch` 抛错统一映射为 `network`，文案提示「网络不可用，或 Neon CORS 未允许当前站点」。
- 不在 URL、日志、错误消息中出现 JWT。

### 9.3 CORS

Neon Data API 默认允许所有来源；建议在 Data API Settings → CORS allowed origins 填：

- `https://vaddenz.github.io`
- `http://localhost:5173`（本地开发）

如果留空（允许所有来源），仍可用，但安全性较低。设置文档中说明。

## 10. 配置、身份与安全

### 10.1 本地存储

| key | 位置 | 内容 |
| --- | --- | --- |
| `mdreader.syncConfig` | localStorage | `{ version: 1, enabled, autoSync, backend, values }` |
| `mdreader.syncState` | localStorage | 上次同步、错误、每 scope cursor |
| `mdreader.syncDeviceId` | localStorage | 随机 UUID，稳定设备标识 |
| `sync_outbox` | 每个仓库 IndexedDB | 变更队列 |
| `kv.syncSeededCollections` | 每个仓库 IndexedDB | 已 seed 的 collection 列表；新增 collection 只补 seed 自己 |
| `kv.syncScope` | 每个仓库 IndexedDB | 该库上次同步的 scope；不一致时回退 cursor 并全量拉取 |
| `kv.syncReset` | 每个仓库 IndexedDB | `Record<collection, maxResetBefore>` |
| `kv.syncTombstones` | 每个仓库 IndexedDB | `Record<collection, Record<recordId, deletedAt>>`；本地删除标记，阻止陈旧远端记录复活 |

`SyncConfig`：

```ts
interface SyncConfig {
  version: 1;
  enabled: boolean;       // 总开关：停用后手动同步也禁用
  autoSync: boolean;      // 自动同步开关：默认 false；关闭后仅手动
  backend: string;
  values: Record<string, string>;
}
```

- 保存配置时：
  - 校验必填字段；`endpoint` 去尾部 `/`；
  - 若 `backend` / `endpoint` / `token` 任一变化，清空 `syncState.repos` 的 cursor，并清除每个仓库库中的 `kv.syncSeededCollections` 与 `kv.syncScope`，使本地数据在新身份下重新 seed；保留 outbox、`syncTombstones` 与本地数据；
  - `enabled = true`；`autoSync` 保持用户当前选择，缺省 false；
  - 切换 `autoSync` 单独保存，不重置 cursor、不影响 outbox；从关到开且 `enabled && configured` 时延迟 3 秒触发一次同步。
- 清除配置：删除 `syncConfig` 与 `syncState`，保留各仓库 outbox；下次重新配置后仍可补推。
- 「清除全部数据」：删除仓库库、仓库配置、GitHub Token，同时清除 `syncConfig`、`syncState`、`syncDeviceId`，避免清空后被远端自动恢复；确认文案加入「跨设备同步配置」。

### 10.2 设备 ID

`crypto.randomUUID()`；不支持时用时间 + 随机数回退。仅用于 LWW 平局裁决，不是身份。

### 10.3 JWT / JWKS

Neon Data API 需要 JWKS 验证 JWT。两种路径：

1. **已有 provider**：Auth0 / Clerk / Keycloak / Firebase 等，按其 JWKS URL 配置 Neon，应用只填 JWT。
2. **个人长期 JWT（本期保留的可选工具）**：附带 `scripts/sync-jwt.mjs`（是否长期维护后续再定）：
   - 生成 RSA 密钥对；私钥写到 `.sync-jwt/private.pem`（gitignore，0600）；
   - 公钥 JWKS 写到 `public/sync-jwks.json`（公钥可公开，随 GitHub Pages 部署）；
   - 签发 `sub` 可配置（默认 `md-reader`）、`role` 默认 `authenticated`、有效期默认 10 年的 RS256 JWT，打印到终端；
   - 用户在 Neon 配置 JWKS URL `https://vaddenz.github.io/md-reader/sync-jwks.json`，把 JWT 粘贴到应用。
   - 支持 `--sub`、`--role`、`--days`、`--aud`、`--jwks`、`--out-dir` 参数；重复运行复用私钥，只重新签发。
   - 不把私钥、JWT 写进仓库或日志；脚本只在本机运行。
3. 若用户不方便部署 JWKS，也可接现有 provider；应用侧不感知差异。

JWT 安全：
- 它是 bearer token，拿到即可读写该 `sub` 的全部同步数据；
- 仅存 localStorage；设置页掩码显示；不写 URL / 日志 / 错误消息；
- 泄露后轮换密钥、更新 Neon JWKS、重新签发；旧 token 随旧 JWKS 移除而失效；
- 与现有 GitHub Token 同一安全等级，README 说明风险。

## 11. UI

### 11.1 路由与导航

- 新路由：`#/settings/sync`；`SETTINGS_SYNC` 常量。
- 设置首页导航新增第 5 项「跨设备同步」，图标为云/循环箭头线性 SVG；摘要：
  - 未配置：「未配置」
  - 已启用且自动：`已启用 · 上次同步 ${timeAgo}`
  - 已启用但自动关闭：`仅手动 · 上次同步 ${timeAgo}`
  - 错误：`同步失败 · 查看详情`
  - 关闭：`已关闭`
- 放置顺序：阅读体验 → 数据管理 → 跨设备同步 → 记忆助手 → 关于。

### 11.2 同步页结构

1. **Header**：标题「跨设备同步」，副标题「阅读进度、高亮、收藏与记忆数据在多台设备间同步；正文与 GitHub Token 不上传。」
2. **状态卡**：状态点 + 文案（未配置 / 已启用 / 同步中 / 离线 / 失败）；上次同步；待推送条数；最近错误。待推送条数在进入页面时打开各仓库库统计 outbox（仓库少、数据量小，可接受），同步完成后由 Provider 刷新。
   - 「自动同步」开关（iOS 式 switch）：**默认关**；关闭时显示「仅手动同步」，并说明「启动、联网、页面隐藏与数据变更都不会自动同步；点击「立即同步」才会同步」。切换立即保存。
   - 「停用」是总开关，停用后自动与手动同步都不可用；「自动同步」关闭只停自动触发，两者文案不要混用。
3. **后端卡**：
   - 后端选择（注册表驱动；当前只有 Neon 时显示静态标签）；
   - 动态字段：接口地址（URL）、JWT（password）；
   - 已保存的 JWT 显示掩码 + 「更换」；更换时输入框为空；
   - 按钮：`测试连接`、`保存并启用`、`立即同步`、`停用`、`清除配置`（危险区样式，二次确认）；
   - 测试连接使用当前表单值（JWT 未更换时用已保存值），不落盘；
   - 保存成功后重置 cursor，提示「已保存；下次同步会全量拉取」；
   - 若 JWT 的 `exp` 在 30 天内，状态卡显示「JWT 将在 X 天后到期」黄色提示；不阻止同步。
4. **同步范围卡**：列出六类数据与「笔记（预留，尚未启用）」；说明「AI Key、训练会话、打开标签页、正文不同步」。
5. **仓库结果卡**：每个已配置仓库一行，显示 `owner/repo`、最近结果/错误；同步中显示当前仓库。
6. **初始化说明**：可折叠 `<details>`，包含 Neon 步骤、CORS、JWT/JWKS、完整 SQL，SQL 带「复制」按钮；链接 `docs/sync-neon-setup.md`。
7. **隐私说明**：JWT 仅存本机；启用后上述数据发送到用户自备 Neon；不经过 md-reader 作者的任何服务器。

### 11.3 Provider API

```ts
interface DataSyncContextValue {
  config: SyncConfig;
  status: 'disabled' | 'unconfigured' | 'idle' | 'syncing' | 'offline' | 'error';
  summary: SyncSummary | null;
  error: string | null;
  pendingCount: number;
  warning: string | null;       // JWT 临近过期等
  syncNow(): Promise<void>;
  testConnection(values: Readonly<Record<string, string>>): Promise<TestResult>;
  saveConfig(next: SyncConfig): Promise<void>;
  setAutoSync(on: boolean): void;
  disable(): void;
  clearConfig(): void;
  refreshPendingCount(): Promise<void>;
}
```

### 11.4 交互细节

- 表单校验：URL 必须 `https://`（允许 `http://localhost` 开发）；JWT 非空；保存/测试时错误就地显示。
- 测试连接中按钮禁用并显示「测试中…」；成功后显示「连接成功：表与 RPC 可用」；若返回 `warning`（如 JWT 临近过期），用黄色提示条展示，不阻断保存。
- 同步中禁用「立即同步」；显示进度「正在同步 owner/repo（2/3）」。
- 首次保存配置后若未打开「自动同步」，状态卡显示「仅手动同步」，并提示「自动同步已关闭，点击「立即同步」开始首次同步」。
- 自动同步关闭时，状态卡显示「仅手动同步」；「待推送条数」可能持续增加，页面提示「自动同步已关闭，点击「立即同步」上传」。
- 自动同步关闭时，如果正在同步，当前轮正常完成；之后的自动触发不再发生。
- 错误文案按 `SyncErrorKind` 映射，不显示原始响应体（可能含敏感信息）；详细错误只显示状态码与短句。
- 离线时「立即同步」禁用，提示「离线，联网后会自动重试」；自动同步关闭时改为「离线，联网后请手动同步」。
- 危险操作：
  - 「停用」：`enabled=false`，保留配置和 outbox；
  - 「清除配置」：删除 config/state；保留 outbox；确认文案说明「不会删除已同步到 Neon 的数据；本机待同步变更会保留，重新配置后可能上传到新后端」；
  - 「清除全部数据」：同时清除同步配置（见 §10.1）；确认文案说明「Neon 上已同步的数据不会被删除；重新配置后仍可能拉回」。

## 12. 错误处理与可观测性

### 12.1 错误分类

```ts
type SyncErrorKind = 'config' | 'auth' | 'notfound' | 'network' | 'server' | 'parse';

class SyncError extends Error {
  kind: SyncErrorKind;
  status?: number;
}
```

| kind | 触发 | 用户文案 |
| --- | --- | --- |
| `config` | 缺字段 / URL 非法 | 配置不完整，请检查接口地址与 JWT |
| `auth` | 401 / 403 | JWT 无效、已过期或没有权限 |
| `notfound` | 404 / 表或 RPC 不存在 | 同步表不存在，请先执行初始化 SQL |
| `network` | fetch 抛错 / 超时 | 网络不可用，或 Neon CORS 未允许当前站点 |
| `server` | 5xx / 其他非 2xx | Neon 服务端错误（状态码） |
| `parse` | 响应不是预期 JSON | 响应格式异常，请检查接口地址 |

### 12.2 日志

- 只记录 `kind`、`status`、`scope`、`collection` 数量；
- 绝不记录 JWT、payload 全文、文档路径列表；
- 不用 `console.error` 输出原始 Response。

### 12.3 失败恢复

- 拉取失败：不 seed、不推送、不改 cursor；outbox 保留；下次重试。
- 拉取成功但应用远端记录失败：cursor 不前进（在应用完成后才落盘），下次重拉；已应用记录幂等。
- 推送失败：已成功批次删除对应 outbox；失败批次保留；cursor 不回退（应用完成后已落盘）。
- 单个仓库失败：其他仓库继续；汇总里标记该仓库错误。
- 远端记录损坏（payload 不符合适配器 sanitize）：跳过该条并计入 `skippedInvalid`；不删除本地数据。

## 13. 兼容与迁移

- `SCHEMA_VER` 2 → 3：仅新增 `sync_outbox`，旧数据不动；`db-migrate` 测试补充 v2→v3。
- 收藏 `favorites` → `favoritesV2`：首次读取时迁移，旧 key 删除；迁移前导出的旧数据仍可读取。
- `MemorySelection` 新增可选 `updatedAt`；旧数据缺省 0，不影响读取。
- 高亮格式不变（仍用 `createdAt` 作为版本）；导出/导入 JSON 格式不变。
- 同步配置不存在 / 后端未知：视为未配置，不报错、不影响本地功能。
- 版本号 `1.6.1` → `1.7.0`。

## 14. 测试

### 14.1 单元测试

- `syncConfig`：缺字段、URL 规范化、未知后端、password 字段、保存重置 cursor；`autoSync` 缺省 false、关闭后持久化、切换不重置 cursor。
- `syncMerge`：LWW、远端时间戳相等时远端获胜、本地较新时保留、tombstone、reset 过滤。
- `syncOutbox`：入队 upsert 去重、rev 更新、推送后 rev 安全删除、reset 清理、按 collection seed 不重复、新增 collection 只补 seed 自己。
- `syncCollections`：六个适配器的 list/get/apply/clearBefore；收藏 V2 迁移；attemptKey；selection 只同步 banks/filters。
- `syncNeon`：mock fetch 的 test / pull 分页 / push body / 401 / 404 / 5xx / network / 超时；断言 Authorization 头、URL 不含 token。
- `syncEngine`：首次 seed、远端较新、本地较新、reset、单仓库 blocked、全仓库顺序、失败保留 outbox。
- `DataSyncProvider`：自动同步关闭时，启动 / online / visibility / dirty 事件均不调用同步；手动 `syncNow()` 仍然执行；重新开启后触发一次。
- 更新现有 `prefs` / `highlights` / `memory` 测试以覆盖原子写入与 outbox。

### 14.2 e2e

新增 `tests/e2e/data-sync.spec.ts`：
- mock Neon Data API（`page.route` 拦截 `**/rest/v1/**`）：
  - 配置页：填 URL + JWT，测试连接成功；
  - 手动同步：seed 本地进度/高亮/收藏，断言 push 请求体；
  - 清空本机 IndexedDB 后（或新 context）用同一 mock 远端，手动同步，断言进度/高亮恢复；
  - 鉴权失败 / 表不存在错误文案；
  - CORS/网络失败提示。
- 现有 e2e 全绿；确保新增设置页不影响设置导航与移动端布局。

### 14.3 验证命令

```
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## 15. 文档与产品原则

- 新增 `docs/sync-neon-setup.md`：Neon Data API 启用、JWT/JWKS（含本地脚本）、SQL、CORS、应用配置、轮换与故障排查。
- 新增 `docs/plans/2026-10-20-md-reader-data-sync-implementation.md`（下一步 writing-plans 产出）。
- README：
  - 功能列表加「跨设备同步（可选，Neon；自动同步默认关闭，需手动开启）」；
  - 数据管理/隐私说明更新；
  - 指向 setup 文档。
- PRODUCT.md：
  - 原则 1 修订为「默认不出本机；启用跨设备同步后，用户数据发送到用户自备 Neon；正文、GitHub Token、AI Key 永不上传」；
  - 能力清单加同步；
  - 约束「无后端」改为「默认无后端；可选用户自备 Neon Data API」。
- DESIGN.md：
  - 设置页两级结构加「跨设备同步」；
  - 新增同步页布局说明；
  - 复用现有卡片/按钮/输入样式，不引入新视觉语言。
- 关于页 / 设置首页隐私文案：从「数据仅存本机」改为「默认仅存本机；启用跨设备同步后，指定数据发送到你自备的 Neon」。
- 版本号 1.7.0。

## 16. 扩展指南

### 16.1 新增后端

1. 在 `src/sync/backends/` 新建文件，导出 `SyncBackendDefinition`；
2. 实现 `create(values)` 返回 `SyncBackend`（`test` / `pull` / `push`）；
3. 在 `backends/index.ts` 注册；
4. 设置页自动出现该后端与字段，无需改 JSX；
5. 补 mock fetch 单测与 setup 文档。

后端契约：`push` 必须保证「旧记录不覆盖新记录」（条件写或服务端 LWW）；`pull` 必须返回 `serverUpdatedAt` 且支持分页。

### 16.2 新增数据类型（含笔记）

1. 在 `src/data/` 定义存储、sanitize、写入函数；
2. 写入函数在同一个事务里调用 outbox helper；
3. 在 `src/sync/collections/` 实现 `SyncCollection`；
4. 在 `collections/index.ts` 注册；
5. 在设置页同步范围卡加一行；
6. 补单测。远端表与后端不变；首次同步会自动只 seed 这个新 collection。

## 17. 风险与限制

- **时钟偏差**：LWW 依赖设备本地时间；严重偏差时较旧编辑可能获胜。个人场景接受，文档说明。
- **JWT 长期有效**：泄露风险高于短期 token；用 RLS 限定 `sub`、限制 CORS、轮换密钥降低影响。不做加密存储。
- **Neon 免费额度 / 冷启动**：首次请求可能较慢；30 秒超时与错误提示覆盖。
- **Data API 变更**：Neon 文档与 API 可能演进；后端实现独立，便于替换。
- **全仓库同步成本**：仓库多、训练记录多时，首次全量拉取较慢；分批 + 游标 + 后续增量缓解。
- **iPhone / 移动浏览器后台**：页面隐藏后的同步可能被系统中断；自动同步开启时下次打开自动补同步，关闭时等待用户手动同步。
- **删除 tombstone 永久保留**：个人数据量小，接受；未来可加清理。
- **同步中的 UI 一致性**：远端进度不会自动滚动当前阅读位置；高亮/首页数据通过 `mdreader:sync-applied` 事件刷新；记忆页在下次进入时读取最新数据。
- **仓库改名 / 换分支**：scope 会变化，旧 scope 的同步数据不会自动迁移；本期不做跨 scope 迁移，文档说明。
- **清除训练数据后导入旧备份**：导入记录的 `ts` / `lastAt` 可能早于 reset 标记，其他设备会按 reset 过滤这批导入；本期不实现「导入即撤销 reset」的复杂语义，文档说明。

## 18. 验收标准

1. 设置页可配置 Neon 后端，测试连接能区分成功 / JWT 失效 / 表不存在 / 网络或 CORS 失败。
2. 在一台设备写入进度、高亮、收藏、SRS、训练记录、题库偏好后，手动同步；另一台设备（清空本机数据后）同步能恢复这些数据。
3. 两台设备修改同一记录，较新时间戳获胜；不同记录互不覆盖。
4. 删除高亮 / 取消收藏后同步，另一台设备对应记录消失。
5. 「清除训练数据」同步后，另一台设备旧训练记录被清掉，且不会被旧 outbox 推回。
6. 多个仓库全部自动同步；切换仓库不需要手动触发；非当前仓库也能同步。
7. 首次配置后「自动同步」默认关闭；启动、联网、页面隐藏与数据变更都不发请求；待同步条数保留；点击「立即同步」能正常拉取 + 推送；手动打开开关后恢复自动同步。
8. 离线 / 后端失败时本地功能不受影响，outbox 保留；自动同步开启时恢复后自动补推，关闭时等待手动同步。
9. `npm run typecheck` / `npm test` / `npm run build` / `npm run test:e2e` 全绿。
10. README / PRODUCT.md / DESIGN.md / setup 文档与实现一致。

## 附录 A：Neon 初始化 SQL

```sql
-- 1. 通用同步记录表
create table if not exists public.sync_records (
  user_id text not null default (auth.user_id()),
  scope text not null,
  collection text not null,
  record_id text not null,
  payload jsonb,
  updated_at double precision not null,
  deleted boolean not null default false,
  device_id text not null default '',
  server_updated_at timestamptz not null default now(),
  primary key (user_id, scope, collection, record_id)
);

create index if not exists sync_records_pull_idx
  on public.sync_records (user_id, scope, server_updated_at);

-- 2. RLS
alter table public.sync_records enable row level security;

drop policy if exists sync_records_own on public.sync_records;
create policy sync_records_own on public.sync_records
for all to authenticated
using (auth.user_id() = user_id)
with check (auth.user_id() = user_id);

-- 3. 权限（若启用 Data API 时已勾选 Grant public schema access，可跳过）
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.sync_records to authenticated;

-- 4. 条件 upsert RPC
create or replace function public.sync_upsert(p_records jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.sync_records (
    user_id, scope, collection, record_id, payload, updated_at, deleted, device_id
  )
  -- Data API 会把 JWT claims 放在 request.jwt.claims；直接取 sub 可避免
  -- authenticated 角色对 auth schema 的 USAGE 依赖。
  select
    current_setting('request.jwt.claims', true)::jsonb->>'sub',
    r.scope, r.collection, r.record_id, r.payload,
    r.updated_at, r.deleted, r.device_id
  from jsonb_to_recordset(coalesce(p_records, '[]'::jsonb)) as r(
    scope text,
    collection text,
    record_id text,
    payload jsonb,
    updated_at double precision,
    deleted boolean,
    device_id text
  )
  on conflict (user_id, scope, collection, record_id) do update
  set payload = excluded.payload,
      updated_at = excluded.updated_at,
      deleted = excluded.deleted,
      device_id = excluded.device_id,
      server_updated_at = now()
  where (
    excluded.updated_at,
    excluded.device_id
  ) > (
    sync_records.updated_at,
    sync_records.device_id
  );
end;
$$;

grant execute on function public.sync_upsert(jsonb) to authenticated;
```

## 附录 B：同步记录示例

```json
{
  "scope": "vaddenz/your-notes@main",
  "collection": "reading.highlights",
  "record_id": "4b7c3f0e-...",
  "payload": {
    "path": "编程/React.md",
    "record": {
      "id": "4b7c3f0e-...",
      "exact": "useEffect 的清理函数",
      "prefix": "…",
      "suffix": "…",
      "decorations": [{ "kind": "bg", "color": "yellow" }],
      "createdAt": 1760000000000
    }
  },
  "updated_at": 1760000000000,
  "deleted": false,
  "device_id": "d4f1…"
}
```

```json
{
  "scope": "vaddenz/your-notes@main",
  "collection": "memory.attempts",
  "record_id": "__reset__",
  "payload": { "before": 1760000000000 },
  "updated_at": 1760000000000,
  "deleted": true,
  "device_id": "d4f1…"
}
```

## 附录 C：同步引擎伪代码

```ts
async function syncAll(backend: SyncBackend): Promise<SyncSummary> {
  const summary: SyncSummary = { repos: [], pulled: 0, applied: 0, pushed: 0, ... };
  const state = loadRepoState();
  const repos = [activeRepo(state), ...state.repos.filter((r) => r.id !== state.activeRepoId)];
  for (const repo of repos) {
    try {
      summary.repos.push(await syncRepo(backend, state.owner, repo));
    } catch (err) {
      summary.repos.push({ repoId: repo.id, scope: scopeOf(state.owner, repo), error: messageOf(err) });
    }
  }
  saveSyncState(...);
  return summary;
}

async function syncRepo(backend, owner, repo): Promise<RepoResult> {
  const db = await openRepoDbForSync(repoDbName(repo.id));
  try {
    const scope = `${owner.toLowerCase()}/${repo.repo.toLowerCase()}@${repo.branch}`;
    const scopeChanged = (await kvGet(db, 'syncScope')) !== scope;
    const resets = await readResets(db);
    const remote = await backend.pull(scope, scopeChanged ? 0 : cursorOf(scope));
    const resetMarkers = remote.filter(isReset);
    for (const m of resetMarkers) await applyReset(db, m, resets);
    const seeded = new Set(scopeChanged ? [] : await kvGet(db, 'syncSeededCollections') ?? []);
    for (const collection of allCollections()) {
      if (seeded.has(collection.name)) continue;
      await seedCollectionOutbox(db, collection, resets);
      seeded.add(collection.name);
    }
    await kvSet(db, 'syncSeededCollections', [...seeded]);
    let applied = 0;
    for (const r of remote) {
      if (isReset(r)) continue;
      if (r.updatedAt <= (resets[r.collection] ?? 0)) continue;
      const collection = collectionFor(r.collection);
      if (collection && await collection.applyRemote(db, r)) applied++;
    }
    const nextCursor = Math.max(scopeChanged ? 0 : cursorOf(scope), ...remote.map((r) => r.serverUpdatedAt), 0);
    updateRepoState(scope, { cursor: nextCursor }); // 先落 cursor，推送失败也不回退
    if (scopeChanged) await kvSet(db, 'syncScope', scope);
    const entries = await readOutbox(db);
    let pushed = 0;
    for (const batch of chunk(entries, 200)) {
      const records = await materialize(db, batch, resets);
      await backend.push(records);
      for (const e of batch) await deleteOutboxIfRev(db, e.id, e.rev);
      pushed += records.length;
    }
    updateRepoState(scope, { cursor: nextCursor, lastSyncAt: Date.now() });
    return { repoId: repo.id, scope, pulled: remote.length, applied, pushed };
  } finally {
    db.close();
  }
}
```
