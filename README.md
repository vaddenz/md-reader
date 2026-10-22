# md-reader（个人知识库阅读器）

> ## ⚠️ 仅供个人使用 —— 这不是面向他人的通用 Markdown 阅读器
>
> 本项目是**作者个人自用**的小工具，唯一用途：在自己的手机 / 电脑浏览器里阅读**自己私有 GitHub 仓库**中的 Markdown 文档（默认仓库为占位配置 `your-name/your-notes`，首次使用需在设置中改为自己的仓库；支持同一用户名下的多个仓库）。
>
> - **不是**通用产品，不面向其他用户设计，也不建议其他人部署使用；
> - 不提供通用使用指引、兼容性承诺或技术支持；
> - 需要自备 GitHub Fine-grained Token 才能读取内容（内容不落在本仓库）；
> - 如果你在寻找通用的 Markdown 阅读器，本项目不适合你，请另寻其他开源项目。

---

手机优先的 PWA：良好的中文排版、mermaid 流程图、图片、删除线 / 高亮、灵活的目录跳转、
全文搜索与离线缓存。所有内容数据仅存于你自己的浏览器本地，经由你自己的只读 Token
直接访问 GitHub API，不经过任何第三方服务；跨设备同步为可选功能，只在你主动配置后
把指定阅读数据发送到你自备的 Neon 端点。

功能：

- 中文排版，内置字体（等线风 / 宋体风，首次联网后离线可用）；
- 阅读排版设置：字体（系统默认 / 等线风 / 宋体风）、正文字号、字体粗细（细 / 常规 / 中粗 / 粗体）、表格与引用字号比例，设置页实时预览 + 字体样张页（`#/font-preview`）并排对比；
- 文字高亮：选中文字 → 黄 / 红底色，持久保存于本机（不写回仓库）；
- 文字笔记：选中文字 → 菜单「笔记」→ 输入并保存；锚点处出现笔记符号，点击查看/编辑，⋯ 菜单可列出当前文档全部笔记；随跨设备同步一起上传；
- 文档朗读：阅读页 `⋯` 菜单「朗读」或选中文字「从这里朗读」；系统 TTS、句级高亮与跟随滚动、暂停/继续、上一句/下一句、语速、睡眠定时、断点续读；代码/表格/mermaid 默认跳过；Edge Android 语音列表为空时仍使用系统默认语音；
- 离线语音包（可选）：朗读设置里下载 Matcha zh-en（约 140MB，ModelScope CDN，存本机 OPFS）；下载后切到本地引擎，完全离线合成、句内精确暂停；初始化/合成失败自动回退系统语音；删除后回退系统；
- 自定义右键菜单：阅读正文内长按 / 右键弹出（复制 / 笔记 / 从这里朗读 / 高亮 / 清除高亮 / 全选）；
- 手动横屏：阅读页头部「横屏 / 旋转」按钮 + 设置页三态单选（全手动，不跟随传感器）；锁定需要全屏上下文，浏览器标签下会自动进入全屏后重试（仍建议以主屏幕应用 / PWA 打开）；
- 同一 GitHub 用户名下的多仓库：设置页添加 / 切换 / 删除；每个仓库拥有独立的本机书库（缓存、收藏、进度、标签页、高亮、笔记、训练数据互不串）；
- mermaid 流程图、图片、删除线 / `==高亮==` 语法标记；
- 灵活的目录跳转、全文搜索；
- 记忆助手：从仓库 JSONL 题库（问答 / 单选 / 多选 / 追问）按艾宾浩斯间隔训练，AI 评分（可配 OpenAI 兼容接口；支持流式输出与「思考过程」展示，OpenCode Go 经仓库内 Worker 代理接入）或离线自评，本地训练记录与统计（`#/memory`）；训练题量与模型设置在「设置 › 记忆助手」，跨仓库共享；
- 跨设备同步（可选，Neon；自动同步默认关闭，需手动开启）：阅读进度、高亮、笔记、收藏、记忆 SRS、训练记录与题库偏好在多台设备间同步；正文、GitHub Token、AI Key 永不上传；
- 离线缓存。

## 文档

- 设计方案：[`docs/specs/2026-10-18-md-reader-design.md`](docs/specs/2026-10-18-md-reader-design.md)（v1.0 权威设计）
- 增量设计（v1.1）：[`docs/specs/2026-10-18-md-reader-v1.1-design.md`](docs/specs/2026-10-18-md-reader-v1.1-design.md)
- 实施计划：[`docs/plans/2026-10-18-md-reader-implementation.md`](docs/plans/2026-10-18-md-reader-implementation.md)
- 实施计划（v1.1）：[`docs/plans/2026-10-18-md-reader-v1.1-implementation.md`](docs/plans/2026-10-18-md-reader-v1.1-implementation.md)
- 真机验收清单（v1.1）：[`docs/acceptance-2026-10-18-v1.1.md`](docs/acceptance-2026-10-18-v1.1.md)
- 记忆助手设计：[`docs/specs/2026-10-19-memory-assistant-design.md`](docs/specs/2026-10-19-memory-assistant-design.md)
- 记忆助手实施计划：[`docs/plans/2026-10-19-md-reader-memory-assistant-implementation.md`](docs/plans/2026-10-19-md-reader-memory-assistant-implementation.md)
- 记忆助手真机验收清单（v1.3）：[`docs/acceptance-2026-10-19-memory-assistant.md`](docs/acceptance-2026-10-19-memory-assistant.md)
- 跨设备同步设计（v1.7）：[`docs/specs/2026-10-20-data-sync-design.md`](docs/specs/2026-10-20-data-sync-design.md)
- 文字笔记设计（v1.8）：[`docs/specs/2026-10-21-notes-design.md`](docs/specs/2026-10-21-notes-design.md)
- 文档朗读设计（v1.11）：[`docs/specs/2026-10-21-tts-design.md`](docs/specs/2026-10-21-tts-design.md)
- 浏览器 TTS 调研（v1.11）：[`docs/research/2026-10-21-browser-tts.md`](docs/research/2026-10-21-browser-tts.md)
- OpenCode Go 代理设计：[`docs/specs/2026-10-21-opencode-go-proxy-design.md`](docs/specs/2026-10-21-opencode-go-proxy-design.md)
- OpenCode Go 代理部署指南（Cloudflare Worker）：[`packages/opencode-proxy/README.md`](packages/opencode-proxy/README.md)
- 文字笔记真机验收清单（v1.8）：[`docs/acceptance-2026-10-21-notes.md`](docs/acceptance-2026-10-21-notes.md)
- 文档朗读验收清单（v1.11）：[`docs/acceptance-2026-10-21-tts.md`](docs/acceptance-2026-10-21-tts.md)
- 跨设备同步配置指南（Neon / JWT / SQL / CORS）：[`docs/sync-neon-setup.md`](docs/sync-neon-setup.md)
- 跨设备同步验收清单（v1.7）：[`docs/acceptance-2026-10-20-data-sync.md`](docs/acceptance-2026-10-20-data-sync.md)

## 开发与自用

以下内容仅供作者本人维护 / 自建时参考；不对其他使用者做兼容性承诺。

### 运行 / 构建

```bash
npm i            # 安装依赖（Node ≥ 20）
npm run dev      # 本地开发（Vite dev server）
npm run build    # 类型检查 + 生产构建（输出 dist/）
npm run preview  # 预览生产构建
```

### 创建 Token

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**；
2. Repository access：勾选需要阅读的仓库（仅支持同一 GitHub 用户名下的仓库，可多选）；
3. Permissions → Repository permissions → **Contents: Read-only**；
4. 生成并复制 Token，在应用引导页粘贴保存（仅存于本机浏览器，不写入仓库）。

### 部署

- push `main` 后由 GitHub Actions 自动构建并部署到 GitHub Pages（见 `.github/workflows/deploy.yml`）。
- **Pages 站点需预先创建**：仓库 Settings → Pages → Source 选择 **GitHub Actions**（即 `build_type=workflow`）。
  工作流里的 `actions/configure-pages`（`enablement: true`）无法用默认 `GITHUB_TOKEN` 创建站点（首跑实证）；
  站点若被删除 / 重置，需手动重建一次（如 `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`）。
- 自建 / fork：需把 `vite.config.ts` 的 `base` 改为与自己的仓库名一致（如仓库 `foo` → `base: '/foo/'`），
  否则静态资源 404；本项目为个人自用，其他部署环境的兼容性由使用者自行承担。
  注意：内置字体的 URL 在 `src/styles/fonts.css` 中硬编码了 `/md-reader/` 前缀，改 `base` 时需一并修改，否则字体静默回退系统字体。

### 字体

阅读器内置两套完整字符集字体（随应用同源分发，不请求任何第三方 CDN）：

| 字体 | 来源 | 版本 | 许可 |
| --- | --- | --- | --- |
| 霞鹜新晰黑·屏幕阅读版（等线风） | [lxgw/LxgwNeoXiZhi-Screen](https://github.com/lxgw/LxgwNeoXiZhi-Screen) | `26.08.21` | IPA Font License 1.0 |
| 思源宋体 / Noto Serif SC（宋体风，可变字重 200–900） | [google/fonts](https://github.com/google/fonts) `ofl/notoserifsc` | `main`（浮动引用） | SIL OFL 1.1 |

- 产物为 woff2（`public/fonts/`），由上游 TTF 无损格式转换（仅格式转换，字形全集不变）；
- 许可全文见 `public/fonts/licenses/`；重新获取 / 转换：`npm run fonts`（一次性脚本，产物入库，不在 CI / 构建中执行）；
- 缓存策略：字体体积大，不进 Service Worker 预缓存清单，改用 CacheFirst 运行时缓存（缓存名 `mdreader-fonts`，有效期 1 年）。
- 离线语义：某字体首次使用（联网）后离线可用；从未使用过的字体离线时回退系统字体（`font-display: swap`，不影响阅读）。

### 高亮数据

- 高亮记录默认仅存本机浏览器（IndexedDB kv 键 `highlights`，按文档路径分组），不写回仓库；
- 设置页「数据管理」区可**导出 / 导入 JSON** 备份（导入按 `路径 + 原文 + 装饰` 合并去重，不覆盖本地已有）；**清除站点数据会丢失本机高亮，建议定期导出**；高亮按仓库独立存放；
- 仓库改动后无法模糊命中的高亮成为「孤儿」：记录保留、暂不渲染，原文恢复后自动重现（导出时一并导出）。

### 笔记数据

- 笔记默认仅存本机浏览器（IndexedDB kv 键 `notes`，按文档路径分组），不写回仓库；
- 每条笔记记录锚定原文（`exact` + 前后文），仓库改动后在正文中自动重锚；原文被改写导致无法定位时成为「孤儿」：笔记保留、列表标记「原文已改动」，不再显示锚点符号；
- 笔记通过跨设备同步的 `reading.notes` 集合同步（新增/编辑/删除均走 LWW + tombstone）；笔记正文与文档正文不同，**不会上传文档正文**。

### 跨设备同步（可选）

- 默认关闭，也默认不发起任何同步请求；在「设置 › 跨设备同步」配置后启用。
- 后端是**你自备的 Neon Data API**（Postgres + JWT），不经过作者的任何服务器；配置步骤、完整 SQL、CORS、JWT/JWKS 与轮换见 [`docs/sync-neon-setup.md`](docs/sync-neon-setup.md)。
- 只同步阅读进度、高亮、笔记、收藏、记忆 SRS、训练记录、题库偏好；**正文、GitHub Token、AI Key / 模型配置、训练会话、标签页、阅读外观不上传**。
- 自动同步**默认关闭**：首次保存后只能手动点「立即同步」；需要自动触发时在同步页打开开关。关闭状态下，启动、联网、页面隐藏与数据变更都不会发请求，变更留在本机队列，点击「立即同步」时补推。
- 数据在 Neon 中为明文存储；JWT 是 bearer token，仅存本机 localStorage，界面掩码显示，不写入 URL 或日志。泄露后按 setup 文档轮换密钥与 JWT。
- 多设备（或两个浏览器 profile）需填写同一接口地址与同一 JWT；多仓库按 `owner/repo@branch` 分别同步。

### 手机更新后一直「加载中」

本地 IndexedDB 升级可能被同一站点的旧标签页 / 旧 PWA 实例占用而阻塞。v1.5.1 起会在约 6 秒后给出提示并自动重试；关闭其它标签页，或强制退出应用后重新打开即可恢复。

### 测试

```bash
npm test                       # 单元测试（Vitest）
npm run typecheck              # 类型检查
npm run test:e2e               # 端到端（Playwright，mock GitHub API；自动构建并起 preview）
npm run corpus -- <dir>        # 本地工具：语料体检（锚点 / 高亮 / mermaid 统计）
npm run conformance -- <file>  # 本地工具：与 GitHub 官方渲染对拍（抽查，可选）
```
