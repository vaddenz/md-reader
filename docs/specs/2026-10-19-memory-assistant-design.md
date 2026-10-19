# md-reader v1.3 · 记忆助手设计方案（Design Spec）

> 日期：2026-10-19 · 状态：待用户评审
> 关系：本文件是 v1.2.0（样式焕新）之上的**增量设计**，只定义「记忆助手」特性；v1.0 / v1.1 设计在未被本文件覆盖的范围内继续有效。
> 目标版本：v1.3.0。

## 1. 概述

### 1.1 本次范围

1. **题库标准**：JSONL（一行一题、一行一个 JSON object，v1.1），支持问答、单选、多选与追问关系；作为题库的唯一来源；数据侧由用户在内容仓库自行迁移，本仓库只实现解析与消费。
2. **记忆助手（单独入口）**：题库选择与筛选；问答题（AI 评分，可降级自评）、选择题（本地判分）与追问链（相邻出题、可就地查看母题）训练；参考答案 / 解析、提示。
3. **艾宾浩斯调度**：按评分推进/回退档位，计算到期复习与每日新题。
4. **模型接入**：OpenAI 兼容 API（Base URL + API Key + 模型名）做 AI 评分；无 Key / 离线 / 失败时降级为自评。
5. **本地训练记录**：学习进度、作答记录、统计、导出/导入。
6. **配套改动**：首页入口、CSP 放宽、PRODUCT.md / README.md / 设置页文案同步。

### 1.2 已确认的决策（讨论结论）

| # | 决策 |
| --- | --- |
| 1 | 题库 JSONL 为唯一来源；`题库.md` 弃用；本期不做「阅读器直读 JSONL」（后续版本另议） |
| 2 | 不做 md → jsonl 迁移脚本（用户自行迁移） |
| 3 | 出题范围：多选题库 + 形态 / 章节 / 题型 / 标签 / 难度筛选 |
| 4 | 模型协议：OpenAI 兼容（`/chat/completions`） |
| 5 | AI 百分制 → 四档动作；间隔序列 `1/2/4/7/15/30/60` 天 |
| 6 | 无 Key / 离线 / 失败 → 自评模式降级，训练与调度照常 |
| 7 | CSP `connect-src` 放宽为 `'self' https:`，允许任意 HTTPS 直连 |
| 8 | 提示为本地渐进式（零 token、离线可用、不影响评分） |
| 9 | 术语口径：代码注释与新增 UI 文案统一用「记忆助手 / 记忆训练 / 题库 / 题目 / 作答 / 评分」，不出现「面试」二字；题库名直接取文件名原文（数据可能含该字样，不做转换） |
| 10 | JSONL 标准扩展（v1.1）：选择题用 `kind`（`single`/`multiple`）+ `options` + `correct` 表达，**本地判分、不调用模型**；追问用 `followUpOf` 链接同文件另一题的 `id`，只影响出题顺序与展示，追问题独立调度 |

## 2. 全局约束

- 技术栈与工程结构不变（React 18 + TS + Vite PWA + IndexedDB + hash 路由）；**不新增运行时依赖**。
- 既有 200 单测 + 25 e2e 必须全绿；新功能按同口径补测。
- 阅读页 / 搜索 / 同步 / 高亮行为不变。全局性改动仅四处：
  1. `index.html` CSP：`connect-src 'self' https://api.github.com` → `connect-src 'self' https:`；
  2. 首页新增「记忆助手」入口；
  3. 设置页「危险区」文案补充「记忆训练数据」；`clearAllData()` 语义扩展为同时清空记忆数据；
  4. `package.json` 版本号 1.3.0。
- 离线语义：题库已获取（缓存）且进度已建立时，训练与自评完全离线可用；仅 AI 评分需要联网。
- 隐私边界（同步修订 PRODUCT.md 原则 1）：正文、Token、训练记录默认不出本机；**AI 评分（仅问答）时把「题干 + 题面 + 参考答案 + 作答文本」发送到用户自己配置的模型地址**，选择题与其余内容不外发；导出 JSON 不含模型 Key。

## 3. 题库标准（JSONL v1.1）

标准全文见**附录 A**（可直接整段复制进内容仓库）。本节只列工程侧要点。

### 3.1 文件与发现

- 目录树中**所有 `.jsonl` 文件**都是题库候选，排除 `archive/` 前缀；不依赖文件名关键词。
- `.jsonl` 不进入阅读器文档管线（`isDoc` 仍只认 `.md`），不出现在文件树 / 搜索 / 最近阅读中。

### 3.2 字段

必需：`id`、`question`、`type`。`kind` 缺省为 `"qa"`：问答必填 `answer`；选择题（`"single"`/`"multiple"`）必填 `options`（`{key,text}[]`）与 `correct`（key 列表），`answer` 变为可选「解析」；追问关系用可选 `followUpOf`（母题 `id`，同文件）。其余可选：`chapter`、`section`、`prompt`（题面附件，不参与评分对照）、`hint`、`tags`、`difficulty`、`source`。未知字段忽略（向后兼容）。

### 3.3 稳定标识（qid）

- `qid` = `cyrb53(规范化题干)` 的 base36 字符串（前缀 `q_`）。规范化 = 去首尾空白 + 连续空白折叠为单个空格。
- 进度主键只认 `qid`：换版本文件、题号重排、答案润色都不丢进度；题干实质改写视为新题（合理语义）。
- 同一题库内 `qid` 重复（题干重复）时，保留首条、跳过后续并告警；跨题库同题（多个版本文件同时被选）在队列组装时按 `qid` 去重，只出一次。

### 3.4 校验与体检报告

逐行解析，坏行只跳过自身。警告类型（含 1-based 行号）：`invalid-json`、`missing-field`、`empty-field`、`bad-type`、`duplicate-id`、`duplicate-qid`、`inapplicable-field`（如问答携带 `correct`）、`bad-options`（选项 key 重复 / text 为空 / 选项少于 2 个）、`bad-correct`（key 不存在于选项 / 单选答案不为 1 个 / 多选答案为 0 个）、`bad-followup`（`followUpOf` 悬空 / 自引用 / 成环）。题库列表与题库详情展示「N 题 / M 处问题」。

## 4. 题库获取与索引

新模块 `src/data/qbankIndex.ts`：

- `listBanks()`：读 kv `tree`（同步产物）→ 过滤 `*.jsonl` 且非 `archive/` → 返回 `{ path, name, sha, size, fetched, questionCount?, issueCount? }[]`；`name` = 文件名去扩展名。
- `ensureBankLoaded(path, client)`（`client` = 页面传入的 GitHub 客户端，数据层不依赖 React）：
  1. 取 `tree` 中该 path 的 `sha`；
  2. `mem_banks[path].sha === sha` → 直接返回解析结果；
  3. 否则先查 `blobs[sha]`（复用现有 blob 缓存）拿原文；缺失且在线 → `GitHubClient.getBlobText` 拉取并写入 `blobs`；
  4. 解析 → 写入 `mem_banks[path] = { path, sha, name, parsedAt, questions, warnings }`；
  5. 离线且无缓存 → 抛 `Error('题库首次获取需要联网，请连网后重试')`。
- 目录树缺失时：概览页引导「先到首页更新目录」。
- 同步完成后（`lastSyncAt` 变化）刷新题库列表与 sha 比对。

## 5. 解析器 `src/lib/qbank.ts`（纯函数、无 IO）

```ts
type BankKind = 'qa' | 'single' | 'multiple';
interface BankOption { key: string; text: string }
interface BankQuestion {
  qid: string;            // 稳定标识（见 3.3）
  id: string;             // 显示用题号
  kind: BankKind;         // 缺省 'qa'
  type: string;
  chapter?: string; section?: string;
  question: string;
  prompt?: string;        // 题面附件 markdown
  hint?: string;
  options?: BankOption[]; // 仅选择题
  correct?: string[];     // 仅选择题：正确项 key 列表
  followUpOf?: string;    // 追问关系：母题 id（同文件）
  answer?: string;        // 问答：参考答案（必填）；选择：解析（可选）
  tags?: string[]; difficulty?: string; source?: string;
  line: number;           // 1-based
}
interface ParseWarning { line: number; kind: string; message: string }
interface ParseResult { questions: BankQuestion[]; warnings: ParseWarning[] }
export function parseBankText(text: string): ParseResult;
```

- 字符串字段校验：必须为非空 string；`tags` 必须为 string[]（元素为非空 string，非法元素丢弃并告警）；`difficulty`/`source` 为 string。
- 选择题校验：`options` 为 `{key,text}` 数组、≥ 2 项、key 题内唯一且 `text` 非空；`correct` 为非空 string[] 且全部命中选项 key；`single` 恰好 1 个正确项。违规按 §3.4 告警并跳过该题（`bad-options` / `bad-correct`）。
- 追问校验（解析完成后统一解析一遍）：`followUpOf` 必须命中同文件某题 `id`、不得自引用、不得成环；违规告警（`bad-followup`）但**保留该题**（按普通题出题）。
- BOM：首行容忍 `\uFEFF`。空行忽略。一行一个 JSON，不允许跨行。
- 解析保持行顺序（= 新题顺序）。
- 纯函数，不访问网络/存储；单测覆盖所有警告类型。

## 6. 数据模型（IndexedDB，库 `mdreader` v1 → v2）

v2 仅**新增** object store，旧数据不动（无破坏性迁移）：

| store | key | value |
| --- | --- | --- |
| `mem_banks` | path | `{ path, sha, name, parsedAt, questions: BankQuestion[], warnings: ParseWarning[] }` |
| `mem_srs` | qid | `{ qid, bankPath, id, stage, dueAt, lastAt, firstAt, lastScore, verdict, reps, lapses }` |
| `mem_attempts` | 自增 id | `{ id, qid, bankPath, idLabel, ts, mode: 'ai'\|'self'\|'choice', score: number \| null, verdict, answer, hit: string[], missed: string[], picked?: string[], correct?: string[], comment, durationMs, hintUsed, revealed }` |

kv 新增键：

- `llmConfig`：`{ baseUrl, apiKey, model }`；
- `memSelection`：`{ banks: string[], filters: { kinds: string[]; chapters: string[]; types: string[]; tags: string[]; difficulty: string[] }, sessionSize: number, newPerDay: number }`（默认 `banks: []`、筛选全空、`sessionSize: 20`、`newPerDay: 10`）；
- `memSession`：训练会话（见 8.4）。

其他：

- `clearAllData()` 现在会同时删除以上 store / kv（删库重建，语义不变）。
- 记录不设上限（个人使用量级可控）；提供导出 / 导入 / 清除训练数据（仅清 `mem_*`，不动题库缓存与阅读数据）。
- 选择题记录：`mode: 'choice'`、`score: null`、`answer` 为空字符串、`hit`/`missed`/`comment` 为空，结果由 `picked` / `correct` 快照推导；统计口径不变（平均分只统计 `mode: 'ai'`）。
- 导出格式：`{ app: 'md-reader', kind: 'memory', version: 1, exportedAt, srs: [...], attempts: [...] }`，**不含** `llmConfig`。导入合并：`mem_srs` 以 `lastAt` 较新者为准；`mem_attempts` 按 `(qid, ts, mode)` 去重追加。

## 7. 艾宾浩斯调度 `src/lib/srs.ts`（纯函数）

### 7.1 档位与评分

- `INTERVALS_DAYS = [1, 2, 4, 7, 15, 30, 60]`（stage 0–6，封顶 60 天）。
- 评分 → 档位动作（AI 模式按分数；自评模式按按钮映射）：

| 动作 | AI 分数 | 自评按钮 | 档位变化 | 下次到期 |
| --- | --- | --- | --- | --- |
| 优秀 excellent | ≥ 85 | — | stage + 1（封顶 6） | 升档后的 stage 间隔（`INTERVALS[新 stage]` 天） |
| 良好 good | 70–84 | 会 | stage + 1（封顶 6） | 同上 |
| 勉强 hard | 50–69 | 模糊 | stage 不变 | 明天 |
| 不会 again | < 50 | 不会 | stage = 0 | 明天 |

- **选择题判分（本地、确定性，不走模型）**：

| 形态 | 结果 | 动作 |
| --- | --- | --- |
| 单选 | 答对 | 优秀 |
| 单选 | 答错 | 不会 |
| 多选 | 全对 | 优秀 |
| 多选 | 漏选（非空真子集） | 勉强 |
| 多选 | 错选（含错误项） | 不会 |

  提交时至少选中一项（未选中不可提交）；选择题 `score` 为 null，判分结果直接落 `verdict`。

- 优秀与良好在间隔上暂不做区分（保持可预测），四档标签完整写入记录，便于后续调参。
- 到期时刻按**本地日界**计算：`dueAt = localDayStart(now + N 天)`；今日到期判定为 `dueAt <= now`。
- 已掌握（仅用于统计与展示）：`stage === 6 && 最近一次 verdict ∈ {excellent, good}`（选择题与自评无分数，故按 verdict 判定）；仍按 60 天复习。

### 7.2 队列组装

```ts
buildQueue({ questions, srs, now, sessionSize, newPerDay, newIntroducedToday })
```

1. 过滤：筛选条件（形态 / 章节 / 题型 / 标签 / 难度）后组成候选池；
2. 到期：`srs.dueAt <= now`（含逾期），按 `dueAt` 升序（逾期最久优先），**不占新题额度**；
3. 新题：无 `srs` 记录者，按题库选择顺序 + 行顺序取前 `max(0, newPerDay - newIntroducedToday)` 条；
4. 合并后按 `sessionSize` 截断（`不限` 为 Infinity）；`qid` 去重；
5. **追问链排序**：对最终队列做一次稳定重排——若某追问的母题也在队列中，把该追问移到母题之后（链上多题按题库行顺序）；母题不在队列时保持原位（训练界面提供「查看母题」）；
6. `newIntroducedToday` = `mem_srs` 中 `firstAt >= 今日 0 点` 的条数。

## 8. 训练流程

### 8.1 状态机

`idle → queue → answering → scoring → result → finished`

- 题目视图：题库名 · 章节 · 题号 · 题型 / 形态标签；追问题额外显示「追问自 Q2.6」徽标与「查看母题」（就地展开母题题干与参考答案，标注「母题上下文，不计入本次记录」）；题干（markdown 渲染）+ 题面附件（markdown 渲染）+ 作答区：
  - 问答：多行文本框；
  - 单选：选项按 `options` 顺序单选；多选：复选；未选中时「提交」禁用。
- 作答提交：问答走 AI 评分（loading + 可取消）或自评；选择题本地立即判分。
- 结果视图（问答）：分数（大号）/ 档位标签 + 命中要点（✓）/ 遗漏要点（!）/ 点评 + 参考答案（markdown 渲染）+「下一题」/「结束训练」。
- 结果视图（选择）：正确 / 漏选 / 错选标签 + 选项着色（正确项绿、误选项红、已排除项灰）+ 解析（`answer` 有则渲染）+「下一题」/「结束训练」。
- 结束视图：仅在队列全部作答完成时出现，展示本次题量、平均分（AI）与档位分布，「继续训练」/「返回概览」；「结束训练」= 清空会话并返回概览。
- 每题记录 `durationMs`（进入题目 → 提交/自评完成）与 `hintUsed`、`revealed`。

### 8.2 提示分层（本地生成、零 token、不影响评分）

- L1：题库 `hint` 原文；缺失时生成引导语「这是一道【type】题，属于「chapter」」。
- L2（问答）：从 `answer` 提取关键词 ≤ 5 个（行内代码 / 加粗词 / 列表首句「：」前短语），去重后展示；仍无则给答案首句前 40 字。
- L2（选择）：随机排除一个错误选项（置灰、标注「已排除」）；仅当错误选项 ≥ 2 时提供（避免直接给出答案）。
- 再往下只能「查看参考答案」（= `revealed`，见 8.3）。
- 提示按钮达到 L2 后置灰（文案「已给足提示」）；仅记录 `hintUsed`，不改变调度。

### 8.3 评分（问答）与判分（选择）

- **选择题**：本地确定性判分（见 7.1），写入 `mode: 'choice'` 记录（含 `picked` / `correct` 快照）；不调用模型、无需 Key；提交前查看参考答案 → 直接按「不会」记录（`revealed: true`）并展示解析。
- **AI 评分（问答）**：调用成功 → 写入 `mode: 'ai'` 记录。
- **自评模式（问答）**（任一条件：未配置 Key、离线、请求失败、用户点击「查看参考答案」后作答）：
  - 展示参考答案，提供三档按钮「会 / 模糊 / 不会」（映射 良好 / 勉强 / 不会）；
  - 写入 `mode: 'self'`、`score: null`；统计里档位分布计入自评，平均分只统计 AI。
- 「查看参考答案」在评分进行中可用：先取消进行中的请求，再进入自评。
- 评分失败不阻塞训练：错误提示 + 一键「改为自评」。

### 8.4 会话持久化与恢复

- kv `memSession`：`{ createdAt, items: { qid, bankPath }[], index, answered: number, scores: number[], startedAt }`。
- 进入训练页：有未完成会话 → 恢复；题库 sha 变化导致 `qid` 找不到 → 跳过并提示条数。
- 刷新 / 中途退出不丢队列；「结束训练」清空会话。

## 9. 模型接入 `src/data/llm.ts`

### 9.1 配置与 URL

- `llmConfig = { baseUrl, apiKey, model }`；UI 掩码显示 Key，仅写本机。
- URL 规范化：去首尾空白与尾部 `/`；若以 `/chat/completions` 结尾直接使用，否则追加 `/chat/completions`（兼容 `https://api.deepseek.com/v1` 与完整 endpoint 两种填法）。

### 9.2 请求与评分契约

- `POST`，头 `Authorization: Bearer <key>`、`Content-Type: application/json`；
- body：`{ model, messages, temperature: 0.2 }`（**不设置** `max_tokens` / `response_format`，最大化兼容性）；
- system prompt（中文）：角色 = 记忆训练助教；输入含题型、题干、题面、参考答案要点；要求按「要点覆盖度 / 准确性 / 完整性」给 0–100 分；要求只输出 JSON、不要复述答案、点评 ≤ 120 字；
- 输出契约：`{ "score": number, "hit": string[], "missed": string[], "comment": string }`；
- 解析：剥离 ```json 围栏与前后杂文 → 取首个 `{` 到末个 `}` → `JSON.parse` → 校验（score 为有限数并钳制 0–100 取整；`hit`/`missed` 为 string[]，各截 120 字、最多 8 条；`comment` 截 500 字）；
- 解析失败：追加纠正指令重试一次；仍失败 → `LlmError('parse')` → 降级自评。

### 9.3 超时、截断与错误映射

- 超时 45s（AbortController）；用户可取消。
- 截断：作答 4000 字、参考答案 6000 字、题干/题面各 2000 字，截断处加「…（已截断）」。
- 错误映射（`LlmError.kind`）：`auth`(401/403)「Key 无效或无权限」；`notfound`(404)「URL 或模型名不存在」；`ratelimit`(429)「限流，请稍后」；`timeout`「请求超时」；`network`「网络不可用（也可能是服务端未允许跨域）」；`server`(5xx)「服务端错误」；`parse`「评分结果无法解析」。
- **测试连接**：发送一条最小请求（`ping`），2xx 即视为可用，同时验证 URL 与 Key。

### 9.4 隐私与前提说明（UI 文案）

- 「作答与参考答案将发送到你填写的地址，其余内容不会离开本机；Key 仅保存在本机。」
- 「直连需服务端允许浏览器跨域（CORS）；Ollama 需配置 `OLLAMA_ORIGINS`。」

## 10. 页面与入口

### 10.1 路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `#/memory` | `MemoryPage` | 概览 + 开始训练 + 题库与范围 + 训练设置 + 模型设置 |
| `#/memory/train` | `MemoryTrainPage` | 训练（队列 / 作答 / 评分与判分 / 结果 / 结束） |
| `#/memory/records` | `MemoryRecordsPage` | 统计 + 记录列表 + 导出/导入/清除 |

首页头部在设置齿轮旁新增「记忆助手」图标入口（`aria-label="记忆助手"`）。`src/app/nav.ts` 增加 `MEMORY`、`memoryHref()`。

### 10.2 MemoryPage（概览）

1. **今日卡**：待复习数、今日已练、连续训练天数、近 7 天平均分（无 AI 记录时显示「—」）。
2. **开始训练**：主按钮；无题库选择 → 提示先选题库；无模型配置 → 提示将使用自评模式。
3. **题库与范围**：题库多选列表（名称、题量、问题数、未获取标记），形态（问答 / 单选 / 多选）/ 章节 / 题型 / 标签 / 难度筛选（多选 chips，选项来自已加载题库）。
4. **训练设置**：每次题量（10 / 20 / 50 / 不限）、每日新题上限（1–50，默认 10）。
5. **模型设置**：Base URL / API Key / 模型名 + 测试连接 + 保存 + 隐私说明。
6. **进度概览**：所选题库的已练 / 总题 / 已掌握 + 「训练记录」入口。

### 10.3 MemoryTrainPage

按 8.1 状态机；顶部显示进度「第 i / N 题」与退出（保留会话）。

### 10.4 MemoryRecordsPage

- 统计：总题数、已练、已掌握、平均分（AI）、连续天数、档位分布、近 14 天趋势（纯 CSS 条）、到期分布（今日 / 3 天内 / 7 天内）。
- 记录列表：默认最近 100 条，可按题库筛选；点击展开作答原文、命中 / 遗漏、点评。
- 数据：导出 JSON、导入 JSON（合并规则见第 6 节）、清除训练数据（二次确认）。

## 11. 样式与视觉

- 新文件 `src/styles/memory.css`，全部使用现有设计令牌（`--page/--card/--ink/--acc/...`），沿用「软影白卡 + 组标签」的既有形态；移动优先。
- 档位标签配色（局部变量，纸面对比度 ≥ 4.5:1）：优秀 = 绿、良好 = 浅蓝（`--acc`）、勉强 = 琥珀、不会 = 红（`--danger`）。
- 分数大号显示用 `tabular-nums`（全局已开）。
- 不做新的视觉世界，不引入新字体。

## 12. 测试与验收

### 12.1 单元测试（新增，Vitest）

| 文件 | 覆盖 |
| --- | --- |
| `tests/unit/qbank.test.ts` | 合法行 / BOM / 空行；十类警告；`tags` 清洗；选择题校验（选项 key 重复、少于 2 项、`correct` 越界、单选多答、问答携带 `correct`）；追问校验（悬空、自引用、成环、合法链）；qid 稳定性（空白变化不变、题干改写变化）；行顺序 |
| `tests/unit/srs.test.ts` | 阈值分档；档位推进与封顶；勉强/不会；选择题判分映射（单选对错、多选全对/漏选/错选）；本地日界 due；队列组装（到期优先、新题额度、形态筛选、追问链排序、去重、截断）；掌握判定；连续天数 |
| `tests/unit/llm.test.ts` | URL 规范化；脏 JSON 提取；分数钳制；解析失败重试一次；七类错误映射；截断 |
| `tests/unit/memory.test.ts` | kv 清洗；导出/导入合并（srs 取新、attempts 去重）；统计聚合（平均分只算 AI） |
| `tests/unit/db.test.ts`（扩展） | v1 → v2 升级后旧 store 数据仍在、新 store 可用 |

### 12.2 e2e（新增 `tests/e2e/memory.spec.ts` + fixtures 扩展）

GitHub mock 增加一份合法题库 `.jsonl`；LLM 端点用 `page.route` 拦截假服务（`https://llm.example/v1/chat/completions`，CSP 放宽后可达）：

1. AI 主链路：选题库 → 开始训练 → 作答 → 评分结果与参考答案可见 → `mem_srs` / `mem_attempts` 落库 → 下一题。
2. 自评降级：未配置 Key → 查看参考答案 → 自评 → 记录 `mode: 'self'`、调度生效。
3. 提示分层：题库 hint 优先展示；无 hint 时关键词；「查看参考答案」后进入自评。
4. 选择题链路（未配置 Key、无需模型）：单选答对 / 答错、多选漏选 / 错选 → 判分与档位变化正确，记录含 `picked` / `correct`；提交前查看参考答案按「不会」记录。
5. 追问链：母题与追问在同一队列时相邻出题（母题在前），追问题可展开母题上下文；母题不在队列时追问正常出题。
6. 会话恢复：作答中刷新页面 → 恢复到同一题；记录页统计与导出可用。

### 12.3 真机验收（用户执行，门）

1. 安卓 PWA 打开首页 → 记忆助手入口可见；
2. 更新目录后选题库（首次联网获取）→ 开始训练；
3. 配置真实模型（URL/Key/模型）→ 测试连接 → AI 评分文案与要点合理；
4. 断网 → 自评降级可用；
5. 记录页数据正确、导出可导入；
6. 阅读、搜索、高亮等既有功能无回归。

### 12.4 命令

`npm test` / `npm run typecheck` / `npm run build` / `npm run test:e2e` 全绿。

## 13. 非目标（本次不做）

- 多题型专项训练（如只练选择题、按形态加权）、AI 生成提示、反向卡片、卡片编辑；
- 通知 / 提醒（含 PWA 推送）、跨设备同步、云备份；
- 「阅读器直读 JSONL 题库」视图（后续版本，用户已确认后置）；
- md → jsonl 迁移脚本；
- 多用户 / 账号体系。

## 14. 风险与开放问题

| 风险 / 问题 | 说明与缓解 |
| --- | --- |
| CSP 放宽 | 已确认；仅放宽 `connect-src`，`script-src` 等不动 |
| 服务商 CORS / 兼容差异 | 文案提示；错误映射区分「网络不可用」并注明可能是 CORS；不设 `max_tokens`/`response_format` 最大化兼容 |
| Token 成本 | 截断 + `temperature 0.2` + 要求简短输出；成本与用量记录后续可加 |
| qid 稳定性 | 题干改动 = 新题（语义合理）；导出/导入可人工干预 |
| JSONL 单行过大 | 建议单行 < 32KB；解析器容忍，不做硬性拒绝 |
| 时区 | 到期按本机时区日界；中国无夏令时，暂不处理 DST |
| 旧数据兼容 | v2 升级只加 store；`clearAllData` 语义不变 |

## 附录 A：题库 JSONL 标准 v1.1

> 可直接整段复制进内容仓库作为题库编写规范。

### A.1 文件约定

- 一个题库 = 一个 `.jsonl` 文件（UTF-8、LF、无 BOM）；记忆助手把仓库中所有 `.jsonl`（`archive/` 除外）视为题库。
- 一行 = 一道题，必须能独立解析为合法 JSON；**禁止多行 JSON / 美化换行**（字符串内换行用 `\n` 转义）；空行忽略。
- 行的顺序 = 新题出题顺序（建议按章节顺序）。

### A.2 字段

| 字段 | 必需 | 类型 | 说明 |
| --- | --- | --- | --- |
| `id` | ✅ | string | 题号，文件内唯一，如 `"Q2.6"`（仅用于显示与引用） |
| `question` | ✅ | string | 题干（单段；换行用 `\n`） |
| `type` | ✅ | string | 题型：概念 / 辨析 / 场景 / 故障 / 追问 / 手写 / 估算 / 开放 / 行为，允许组合 |
| `kind` | 可选 | string | 形态：`"qa"`（缺省）/ `"single"` / `"multiple"` |
| `answer` | 条件 | string | 参考答案 / 解析，markdown；`qa` 必填，选择题可选 |
| `options` | 条件 | object[] | 仅选择题必填：`[{"key":"A","text":"…"}]`；key 题内唯一、text 非空、≥ 2 项 |
| `correct` | 条件 | string[] | 仅选择题必填：正确项 key 列表；`single` 恰好 1 个，`multiple` ≥ 1 个，必须 ⊆ 选项 key |
| `followUpOf` | 可选 | string | 追问关系：本题为哪道题的追问（值 = 同文件另一题的 `id`） |
| `chapter` | 建议 | string | 章节，如 `"2. 事件循环与异步模型"` |
| `section` | 可选 | string | 小节，如 `"2.2 补充题目"` |
| `prompt` | 可选 | string | 题面附件（示例代码、表格），markdown；不参与评分对照 |
| `hint` | 可选 | string | 提示（建议一行） |
| `tags` | 可选 | string[] | 标签，用于筛选 |
| `difficulty` | 可选 | string | 难度（如 基础 / 进阶 / 高难） |
| `source` | 可选 | string | 回链知识文档（相对路径#锚点） |

### A.3 示例（一道题一行；此处为便于阅读未折行）

问答（缺省形态）：

````json
{"id":"Q2.6","type":"概念","chapter":"2. 事件循环与异步模型","section":"2.2 补充题目","question":"poll 阶段什么时候会阻塞？阻塞多久？","hint":"关注活跃句柄与最近的定时器","answer":"- 当本轮没有待执行的 `setImmediate`、没有到期定时器、且仍有活跃句柄时，poll 会阻塞等待 I/O 事件。\n- 阻塞时长 = min(最近的定时器到期时间, 平台最大等待时间)；有 I/O 事件到达会被立即唤醒。\n- 关键点：这就是「服务空闲时 CPU 接近 0」的原因。","tags":["事件循环"]}
````

含代码的题面与答案（`\n` 转义）：

````json
{"id":"Q2.3","type":"手写/追问","chapter":"2. 事件循环与异步模型","question":"写出下面程序的输出顺序。","prompt":"```js\nsetTimeout(() => console.log('t'), 0);\nPromise.resolve().then(() => console.log('p'));\nprocess.nextTick(() => console.log('n'));\n```","hint":"先看同步代码与 nextTick，再看微任务","answer":"- 输出：`n → p → t（示例）`。\n- 解释：nextTick 先于 Promise 微任务；定时器最后。"}
````

单选：

````json
{"id":"Q1.1","kind":"single","type":"概念","chapter":"1. 运行时架构","question":"负责事件循环与线程池的内置依赖库是？","options":[{"key":"A","text":"libuv"},{"key":"B","text":"V8"},{"key":"C","text":"OpenSSL"},{"key":"D","text":"zlib"}],"correct":["A"],"answer":"libuv 提供事件循环与线程池；V8 负责 JS 执行。"}
````

多选：

````json
{"id":"Q1.2","kind":"multiple","type":"辨析","chapter":"1. 运行时架构","question":"以下哪些属于运行时内置依赖库？","options":[{"key":"A","text":"V8"},{"key":"B","text":"libuv"},{"key":"C","text":"React"},{"key":"D","text":"OpenSSL"}],"correct":["A","B","D"],"hint":"与前端框架无关的依赖"}
````

追问（链到另一题）：

````json
{"id":"Q2.7","type":"追问","followUpOf":"Q2.6","chapter":"2. 事件循环与异步模型","question":"那 poll 阻塞时发生 I/O 事件会怎样？会立刻打断当前回调吗？","answer":"- 会唤醒 poll，但要等当前正在执行的回调结束后才处理……"}
````

### A.4 校验与运行时规则

- 工具/助手逐行解析；坏行只跳过自身，并给出行号与原因：JSON 非法、必填字段缺失或为空、字段类型错误、`id` 重复、题干重复、选择题选项/答案非法、`followUpOf` 悬空（找不到目标）/ 自引用 / 成环。
- 追问关系只影响**出题顺序与展示**：追问题独立进入调度（有自己的进度与到期）；同一队列内，追问紧随其母题之后；训练界面显示「追问自 Q2.6」并可展开母题内容。`followUpOf` 指向不存在/自引用/成环时告警，仍按普通题出题。
- 选择题由助手本地判分（单选对 = 优秀、错 = 不会；多选全对 = 优秀、漏选 = 勉强、错选 = 不会），不调用模型。
- 未知字段一律忽略（向后兼容：以后新增 `options`、`points` 等字段不破坏旧客户端）。
- 建议单行 < 32KB。
