# md-reader · 设计方案（Design Spec）

| 项目 | 内容 |
| --- | --- |
| 状态 | 已确认（2026-10-18 用户批准），待实施 |
| 定位 | **个人自用工具，非通用产品**（README 与应用内「关于」页同步声明） |
| 内容源 | `your-name/your-notes`（私有仓库，默认接入） |
| 应用仓库 | `vaddenz/md-reader`（公开，仅含代码，零内容） |
| 部署 | GitHub Pages：`https://vaddenz.github.io/md-reader/` |

---

## 1. 背景与目标

**问题**：在安卓手机上阅读私有仓库里的 Markdown 体验差——排版不佳、mermaid 流程图不渲染。

**目标**（在不把内容交给任何第三方的前提下）：

1. 排版良好（中文、手机优先）
2. mermaid 流程图原生渲染
3. 图片支持（仓库内相对路径图片）
4. `~~删除线~~`、`==高亮==`
5. **灵活的目录跳转**（详见 §4）
6. 全文搜索（离线可用）
7. 离线整仓缓存
8. 收藏 + 阅读进度

**非目标（v1 明确不做）**：多仓库管理 UI、手机端编辑、分享/协作、服务端组件、面向他人的产品化与兼容承诺。

---

## 2. 已验证的技术事实（2026-10-18 对真实语料实测）

| # | 事实 | 数据 / 方法 | 对设计的约束 |
| --- | --- | --- | --- |
| 1 | 页内锚点全兼容 | 43 篇共 **1042** 条 `](#...)` 链接，用 `github-slugger` 生成标题 id 后 **0 条失败** | 标题 id 用 github-slugger（裸 slug，**不加** `user-content-` 前缀）；文档自带目录/回链直接可用 |
| 2 | `==高亮==` 零误伤 | 全仓渲染后 `<mark>` 误报 **0**（正文 `===` 均在代码内） | 启用 markdown-it-mark |
| 3 | 正文无裸 HTML | 13 处疑似全部位于代码块/行内代码（提示词模板示例） | `html: false`，更安全零损失 |
| 4 | 单换行 = `<br>` | 用 GitHub 官方渲染接口实测：`line1\nline2` → `line1<br>line2` | markdown-it 开 `breaks: true` 对齐 GitHub |
| 5 | 裸 URL 需要自动链接 | 全仓 **559** 行存在裸 `https://…`（参考资料段落） | 开 `linkify: true` 对齐 GFM |
| 6 | 规模与结构 | 43 篇、约 3.7MB 文本、**0 图片**、0 公式/脚注/任务列表；29 篇含 mermaid；默认分支 `main` | 全量缓存可行；mermaid 是核心能力；图片路径预留 |
| 7 | GitHub 渲染 HTML 接口可用 | `Accept: application/vnd.github.html+json` 可拿到官方渲染结果 | 作为可选的渲染对拍测试手段（§12） |

**语料假设**（实现时以实际为准兜底）：文档以「知识要点 ↔ 题库 ↔ 深挖」三件套互链，手工目录在每篇顶部，表格与代码块密集。

---

## 3. 产品形态

- **名称**：仓库/项目 `md-reader`；应用内标题「知识库」（可在配置中改）。
- **形态**：手机优先的 PWA。安卓 Chrome「添加到主屏幕」后独立窗口运行；桌面浏览器同样可用。
- **接入**：v1 单仓库（默认 `your-name/your-notes@main`），owner/repo/branch 可在设置中修改；不做多仓库列表 UI。
- **目录刷新**：首页与阅读页文件树抽屉提供「更新目录」按钮（触发增量同步）；未缓存（已过期）文档在目录中带「未缓存」标记（见 §5.4）。
- **语言**：界面与文案均为中文。
- **首次使用流**：设置页粘贴 Token → 校验 → 全量同步（带进度）→ 首页。
- **无 Token 不可用**：未配置或 Token 失效时停留在引导页，展示创建 Fine-grained Token 的图文步骤。

---

## 4. 导航系统（「灵活目录跳转」的完整定义）

| # | 能力 | 行为 |
| --- | --- | --- |
| 1 | 全局文件树 | 阅读页任意位置一步呼出（抽屉），按「根文档 / 子目录」分组；当前文档高亮；点击秒切 |
| 2 | 文档内 TOC | 解析全部标题（h1–h4）；阅读时当前位置自动高亮（滚动监听）；点击滚动直达 |
| 3 | 上下篇 | 按文件树深度优先顺序给「上一篇 / 下一篇」，置于正文底部 |
| 4 | 互链直达 + 返回来源 | 文档间 `*.md` 相对链接应用内跳转；跳转后顶部出现「← 返回来源」条；来源由导航历史栈记录 |
| 5 | 搜索直达 | 搜索结果点击后打开文档并滚动到第一个命中，命中词全文高亮（上限 200 处防卡顿），可继续跳到下一处 |
| 6 | 系统返回手势 | 每次内部跳转（TOC 锚点除外，锚点由浏览器原生处理）都写入浏览器历史；**安卓返回手势 = 回到上一处**，逐级回退到首页 |
| 7 | 关联文档面板 | 正文底部「相关文档」：我引用了谁 / 谁引用了我，一键互跳（三件套互跳场景）；无引用时不显示 |

实现要点：

- 路由采用 **hash 路由**（对 GitHub Pages 无 404 配置要求，PWA 内表现稳定）。
- 路由形态：`#/`、`#/doc/<encodeURIComponent(path)>?to=<headingId>`、`#/search?q=…`、`#/settings`。
- 滚动位置：每次跳转时把当前位置写入 `history.state`；返回（POP）时精确恢复。锚点跳转由浏览器原生完成，配合 CSS `scroll-margin-top` 让标题不被顶栏遮挡。
- 「返回来源」：仅当上一历史项为同类跳转时显示，点击等价于一次返回。

---

## 5. 数据与同步（离线核心）

### 5.1 API 方案（仅 `https://api.github.com`）

| 用途 | 接口 | 说明 |
| --- | --- | --- |
| Token 校验 | `GET /user` | 显示登录名 |
| 仓库校验 | `GET /repos/{owner}/{repo}` | 取 `default_branch` |
| 目录清单 | `GET /repos/{o}/{r}/git/trees/{branch}?recursive=1` | 一次拿全树（path/sha/size/type） |
| 文件内容 | `GET /repos/{o}/{r}/git/blobs/{sha}` + `Accept: application/vnd.github.raw` | 按内容 SHA 去重拉取 |
| 图片等二进制 | 同上 | 按需拉取，按 sha 缓存 |

- 所有请求带 `Authorization: Bearer <PAT>`；并发上限 4；失败指数退避（最多 3 次）。
- 403 且限流（`X-RateLimit-Remaining: 0`）→ 按 `X-RateLimit-Reset` 提示并停止重试循环（个人使用量级远低于 5000/h，仅作防护）。

### 5.2 同步算法

1. 拉全树 → 过滤出文档（`*.md`）与静态资源（图片扩展名）。
2. 与本地记录比较（三态）：**新增 = 待下载；sha 变化且本地已缓存 = 待更新下载；sha 变化但本地未缓存（已过期）= 仅更新记录中的 sha、不下载；本地有而树中无 = 待删除**（见 §5.4）。
3. 仅下载差异文件（改动 1 篇 = 1 次请求）；每篇写入即持久化。
4. 更新 `kv.tree`（含全部条目，供链接/图片解析）、`kv.lastSyncAt`。
5. 同步后重算 `kv.links`（全语料互链索引，见 §4-7），耗时 <1 秒。
6. 首次同步约 1 + 43 次请求、约 3.7MB；后续打开时自动比对（1 次请求）发现变更即后台增量同步。

### 5.3 客户端存储（IndexedDB，库名 `mdreader`，v1）

| Store | Key | Value |
| --- | --- | --- |
| `files` | `path` | `{ path, sha, size, text: string \| null, title, lastUsedAt, updatedAt }`（`text: null` = 已过期未缓存） |
| `blobs` | `sha` | `{ sha, blob, updatedAt }`（图片） |
| `kv` | 字符串 | `config` `{owner,repo,branch}`；`tree`；`links`；`favorites`；`progress` `{[path]:{ratio,headingId?,updatedAt}}`；`lastDoc`；`lastSyncAt`；`lastSweepAt`；`schemaVer` |

- localStorage：`mdreader.token`（PAT）、`mdreader.tokenSaved`（记住开关）。
- 首次同步成功后调用 `navigator.storage.persist()` 申请持久化存储，降低被系统清理概率。
- 版本/损坏自愈：`schemaVer` 不符或读取异常 → 清库重建并全量重同步（收藏/进度尽力迁移，失败仅提示）。
- 设置页展示 `navigator.storage.estimate()` 的占用；提供「清除全部数据」按钮。

### 5.4 缓存过期策略（7 天 TTL）

- **规则**：文档正文（`files.text`）自**最后一次使用起 7 天**未再使用即被自动清理（`text → null`）；「使用」= 打开阅读或搜索「纳入全文搜索」；新同步但从未打开的文档从同步时刻起算。
- **保留**：目录、sha、标题、收藏、阅读进度全部保留；目录中未缓存文档显示「未缓存」标记。
- **清理时机**：应用启动时、每次同步完成后各扫一遍（纯本地操作，无网络开销）。
- **按需重下**：点击未缓存文档 → 按当前 sha 下载 → 写入并刷新 `lastUsedAt`；离线时提示「需联网下载后阅读」并提供重试。
- **搜索**：未缓存文档**不参与搜索**（直接跳过）；搜索页显示「N 篇未缓存已跳过」与「纳入全文搜索」按钮，点击后按需下载（并发 4、带进度）再重新搜索，下载即刷新其 `lastUsedAt`。
- **收藏不豁免**：收藏的文档同样遵循 7 天规则（用户确认）。
- **图片**：暂不参与过期（当前语料无图片），后续按需扩展。

---

## 6. 渲染内核

### 6.1 markdown-it 配置（全部有实测依据）

```js
markdownIt({
  html: false,        // 实测：正文无裸 HTML（§2-3）
  breaks: true,       // 实测：对齐 GitHub 单换行→<br>（§2-4）
  linkify: true,      // 实测：559 处裸 URL，对齐 GFM（§2-5）
  typographer: false, // 与 GitHub 一致，不做智能标点替换
}).use(markdownItMark); // ==高亮==；~~删除线~~ 与表格为内置
```

自定义渲染规则：

1. **标题 id**：core 规则按文档顺序用 `github-slugger` 生成（含重复标题 `-1/-2` 去重），不使用 `user-content-` 前缀（内部链接全部指向裸 slug，天然吻合）。
2. **链接**：`#anchor` 保留原生；`*.md`（相对路径，支持 `./` `../`、URL 编码、可带 `#anchor`）解析为应用内路由；其余外链 `target="_blank" rel="noopener"`。目标不存在时提示「文件不存在」并停留原处。
3. **图片**：相对路径渲染为带 `data-src` 的占位 `<img>`，进入视口后经 blobs API 拉取并以 ObjectURL 显示（缓存于 `blobs`，按 sha 去重）；外链图片直接加载（离线时显示 alt 占位）；加载失败显示 alt 文本。
4. **代码块**：默认用 highlight.js 高亮（常用语言集）；`info === 'mermaid'` 的 fence 输出占位节点，进入视口后动态 `import('mermaid')` 渲染（懒加载 + 代码分割），失败时降级展示原始源码与错误提示。
5. **代码复制**：代码块右上角一键复制按钮。

### 6.2 mermaid 细节

```js
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'inherit' });
```

- 渲染队列最大并行 2；`IntersectionObserver` 预加载视口外 400px。
- 宽图容器横向滚动；页面保持可缩放（viewport 不设 `user-scalable=no`）。
- mermaid 的 JS chunk 同样由 Service Worker 预缓存，保证**离线也能渲染**。

### 6.3 中文移动端排版

- 字体栈：`-apple-system, "PingFang SC", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif`（系统字体，零网络字体，隐私与性能双收益；**不使用**任何 CDN 资源）。
- 正文 17px / 行高 1.8 / 版心最大宽度 46rem；段落、列表、引用块间距按中文阅读节奏设定。
- 表格横向滚动；行内代码与代码块等宽字体栈齐备；`img { max-width:100% }`。
- 顶栏吸顶 + `scroll-margin-top`；底部留出 `env(safe-area-inset-bottom)`。

---

## 7. 搜索

- **算法**：全部缓存文本上的**精确子串匹配**（中文无需分词、不漏不错）；查询按空白切分为多词，**AND** 语义；ASCII 不区分大小写。
- **排序**：总命中次数 + 标题命中加成 ×5 + 路径命中加成 ×2；结果按文档聚合，展示前 3 条带上下文（±40 字）的片段并高亮。
- **执行**：v1 在主线程执行（3.7MB 扫描实测毫秒级）；若真机压测不达标则移入 Web Worker（接口不变）。
- **UI**：顶部进入搜索页（`#/search`），输入即时搜索（防抖 200ms）；结果点击直达命中处并高亮（§4-5）。
- **离线**：纯本地计算，飞行模式完全可用。
- **过期文档**：未缓存文档不参与搜索（见 §5.4）；提供「纳入全文搜索」按需下载后再搜。

---

## 8. 收藏与阅读进度

- **阅读进度**：滚动比例（+ 最近可见标题 id 辅助）节流写入，`visibilitychange` 时补写；打开文档时自动恢复到 ±5% 范围；打开同时刷新该文档 `lastUsedAt`（过期时钟，见 §5.4）。
- **收藏**：阅读页星标切换；首页「收藏」区直达。
- **首页区块**：继续阅读（最近 3 篇）→ 收藏 → 全部文档树；顶部为搜索入口 + 同步状态（上次同步时间 / 进行中 / 离线）。

---

## 9. 安全与隐私

| 项 | 决策 |
| --- | --- |
| Token 类型 | GitHub Fine-grained PAT：仅授权目标仓库、`Contents: Read-only`；建议有效期 90 天（可自设）；设置页附创建步骤 |
| Token 存放 | 仅本机 localStorage；不写入 URL、日志；UI 中默认掩码显示 |
| 出站范围 | 仅 `https://api.github.com`（CSP `connect-src` 锁死）；无任何第三方脚本/字体/图片/CDN |
| 内容可见性 | 内容不落任何托管平台；应用仓库公开但零内容；站点加 `<meta name="robots" content="noindex,nofollow">` |
| 渲染安全 | `html: false` + mermaid `securityLevel: 'strict'`；依赖全部本地打包并锁版本 |
| 数据清理 | 设置页「清除全部数据」= 清空 IndexedDB + localStorage 并回引导页 |
| 定位声明 | README、应用「关于」页、引导页三处声明「个人自用，非通用工具」 |

---

## 10. 工程结构与技术栈

- **栈**：React 18 + TypeScript + Vite；`react-router-dom`（hash 模式，自带滚动由本应用接管）；`vite-plugin-pwa`；`idb`；`markdown-it` + `markdown-it-mark` + `github-slugger`；`mermaid`；`highlight.js`。图标用内联 SVG（不引图标库）。
- **结构**：

```
md-reader/
├─ src/
│  ├─ app/           # 路由、外壳、主题变量
│  ├─ pages/         # 首页 / 阅读页 / 搜索页 / 设置页 / 引导页
│  ├─ components/    # FileTree / TocDrawer / SearchBox / MermaidBlock / CodeBlock …
│  ├─ markdown/      # markdown-it 配置、自定义规则、slug 管理
│  ├─ data/          # github 客户端、IndexedDB、同步引擎、搜索、互链索引
│  ├─ state/         # 上下文与 hooks（token、同步状态、进度、收藏）
│  └─ styles/        # 排版与响应式样式
├─ tests/
│  ├─ unit/          # Vitest
│  └─ e2e/           # Playwright（mock GitHub API + 真实语料 fixtures）
├─ scripts/
│  ├─ corpus.mjs     # 语料体检：锚点/链接/高亮误报/mermaid 计数
│  └─ conformance.mjs# （可选）GitHub 官方渲染对拍
└─ docs/specs/       # 本方案
```

- **状态管理**：React Context + hooks，不引入重型状态库。

---

## 11. 部署

- 新公开仓库 `vaddenz/md-reader`（唯一内容为代码与文档）。
- GitHub Actions：push `main` → `npm ci` → `npm run build`（Vite `base=/md-reader/`）→ 上传并部署 GitHub Pages（官方 `deploy-pages` 流程）。
- hash 路由使站点无需 404 重写；站点启用 noindex（§9）。
- 版本策略：应用版本号显示于设置页；缓存 schema 与版本联动（§5.3）。

---

## 12. 测试与验收

### 12.1 单元测试（Vitest）

1. **锚点全量校验**：以真实笔记语料为 fixture，断言全部 `](#…)` 链接可解析；覆盖重复标题 `-1/-2`、全角标点、emoji。
2. 相对链接解析：`./` `../`、子目录、URL 编码、带锚点、目标缺失分支。
3. 渲染快照：表格、`~~`、`==`、`breaks`、linkify、mermaid fence 提取、代码高亮。
4. 搜索：中文子串、英文大小写、多词 AND、排序、片段截取。
5. 同步 diff：新增/修改/删除/无变化四态。
6. 进度与收藏：写入/读取/异常自愈。

### 12.2 端到端（Playwright，mock `api.github.com`）

覆盖场景：引导配置 Token → 全量同步（进度可见）→ 打开文档 → TOC 跳转 → mermaid 渲染出 SVG → 互链跳转与「返回来源」→ 系统返回等价行为（history.back）→ 搜索命中直达 → 收藏 → 进度恢复（reload 后）→ 离线（`context.setOffline`）阅读与搜索 → Token 失效（401）引导重授权且缓存保留。

### 12.3 语料体检脚本

`npm run corpus -- <dir>`：输出锚点/链接失效率、`<mark>` 误报数、mermaid 块计数、文件与体积统计（即本方案 §2 的自动化版本）。

### 12.4 渲染对拍（可选，本地开发用）

`npm run conformance -- <file>`：对比 GitHub 官方渲染（`html+json`）归一化后的文本结构，抽查一致性。

### 12.5 真机验收清单（P4 逐项过）

1. 首次配置：粘贴 PAT → 同步 43 篇完成，显示进度与耗时。
2. 飞行模式：任意文档可读，搜索可用。
3. 打开《智能体开发知识要点_2026年10月》：顶部目录点击跳转正常，滚动时 TOC 高亮正确。
4. mermaid：抽查 5 篇 ≥10 张图正常渲染；宽图可横向滚动。
5. 互链：知识要点 → 《智能体/Mem0.md》；「← 返回来源」回到原断点。
6. 安卓返回手势逐级回退（阅读 → 来源 → 首页）。
7. 搜索「MVCC」命中多篇、直达并高亮；「gVisor 沙箱」AND 语义正确。
8. 收藏 2 篇；阅读进度滚到中部退出重开，恢复误差 ≤5%。
9. PWA：添加到主屏幕 → 独立窗口打开 → 离线可启动。
10. 内容更新：push 一篇修改 → 手机自动增量同步（请求数可见于同步状态页）。
11. Token 失效：提示重新授权，本地缓存不清。
12. 性能：打开最大文档（130KB + 多图）滚动流畅，无明显卡顿。
13. 过期清理：将某篇文档的 `lastUsedAt` 调整为 8 天前并重启应用 → 目录显示「未缓存」→ 点击后自动下载并正常阅读。
14. 目录手动更新：仓库 push 一篇修改 → 手机点「更新目录」→ 仅该篇增量更新；未缓存文档不会被同步重新下载。

---

## 13. 实施阶段（逐阶段验收，不通过不进下一阶段）

| 阶段 | 内容 | 验收物 |
| --- | --- | --- |
| P0 | 仓库初始化 + 脚手架 + 部署链路 + PWA 壳 | 手机打开占位页，可安装 PWA |
| P1 | Token 配置 + GitHub 客户端 + 全量/增量同步 + IndexedDB | 43 篇同步进手机，断网可打开 |
| P2 | 渲染内核 + 阅读器 + 全部跳转能力（§4、§6） | 真正开始用：mermaid/高亮/互链/TOC/返回 |
| P3 | 搜索 + 收藏/进度 + 离线打磨 + 错误态 | 搜「MVCC」直达命中；进度恢复 |
| P4 | 测试补全 + 语料体检 + 真机走查 + 使用文档 | §12.5 全过 |

---

## 14. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| PAT 到期（如 90 天） | 401 时引导重新授权，缓存与进度保留；文档建议按需设置更长有效期 |
| 首次同步慢/中断 | 并发 4 + 进度显示；按 sha 断点续传（已写入的跳过） |
| 低端机大文档卡顿 | mermaid 懒渲染 + 并行≤2；搜索可切 Worker；样式避免重排 |
| IndexedDB 被系统清理 | `storage.persist()`；检测到缓存缺失时提示并自动重同步 |
| GitHub API 行为变化 | 客户端封装于 `data/github` 单一模块，便于适配 |
| 渲染与 GitHub 有差异 | §2 已校准关键项；保留 §12.4 对拍工具兜底 |
| 过期清理误伤 | 打开即刷新 `lastUsedAt`；清理仅在启动/同步后执行；未缓存文档离线点击有明确提示与一键重下 |

---

## 15. 后续扩展（v1 之后，不在本次范围）

多仓库切换、深色模式与字号面板、手机端轻编辑（需写权限 Token）、OAuth Device Flow、多端进度同步、批注。

---

## 附录 A：待办与决策记录

- 2026-10-18：路线确认为「自建 Token 阅读器 SPA」（对比 GitHub Pages 公开站、Cloudflare Pages+Access 两方案后选定）。
- 2026-10-18：v1 范围确认为「渲染内核 + 全文搜索 + 离线整仓缓存 + 收藏/进度」，不含多仓库、编辑、主题面板。
- 2026-10-18：新增「灵活目录跳转」要求，落实为 §4 七项能力。
- 2026-10-18：用户要求在 README 中声明「仅供个人使用、非通用 Markdown 阅读器」（已同步至 README、「关于」页与引导页设计）。
- 2026-10-18：新增缓存过期策略（正文 7 天未使用自动清理、点击按需重下、搜索直接跳过未缓存并提供「纳入全文搜索」、收藏不豁免）与目录「更新目录」手动刷新按钮（§3、§5.4、§7、§12.5）。
