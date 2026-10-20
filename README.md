# md-reader（个人知识库阅读器）

> ## ⚠️ 仅供个人使用 —— 这不是面向他人的通用 Markdown 阅读器
>
> 本项目是**作者个人自用**的小工具，唯一用途：在自己的手机 / 电脑浏览器里阅读**自己私有 GitHub 仓库**中的 Markdown 文档（默认指向作者的 `vaddenz/interview` 仓库）。
>
> - **不是**通用产品，不面向其他用户设计，也不建议其他人部署使用；
> - 不提供通用使用指引、兼容性承诺或技术支持；
> - 需要自备 GitHub Fine-grained Token 才能读取内容（内容不落在本仓库）；
> - 如果你在寻找通用的 Markdown 阅读器，本项目不适合你，请另寻其他开源项目。

---

手机优先的 PWA：良好的中文排版、mermaid 流程图、图片、删除线 / 高亮、灵活的目录跳转、
全文搜索与离线缓存。所有内容数据仅存于你自己的浏览器本地，经由你自己的只读 Token
直接访问 GitHub API，不经过任何第三方服务。

功能：

- 中文排版，内置字体（等线风 / 宋体风，首次联网后离线可用）；
- 阅读排版设置：字体（系统默认 / 等线风 / 宋体风）、正文字号、字体粗细（细 / 常规 / 中粗 / 粗体）、表格与引用字号比例，设置页实时预览 + 字体样张页（`#/font-preview`）并排对比；
- 文字高亮：选中文字 → 黄 / 红底色，持久保存于本机（不写回仓库）；
- 自定义右键菜单：阅读正文内长按 / 右键弹出（复制 / 高亮 / 清除高亮 / 全选）；
- 手动横屏：阅读页头部「横屏 / 旋转」按钮 + 设置页三态单选（全手动，不跟随传感器）；锁定需要全屏上下文，浏览器标签下会自动进入全屏后重试（仍建议以主屏幕应用 / PWA 打开）；
- mermaid 流程图、图片、删除线 / `==高亮==` 语法标记；
- 灵活的目录跳转、全文搜索；
- 记忆助手：从仓库 JSONL 题库（问答 / 单选 / 多选 / 追问）按艾宾浩斯间隔训练，AI 评分（可配 OpenAI 兼容接口）或离线自评，本地训练记录与统计（`#/memory`）；
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
2. Repository access：仅选择 `vaddenz/interview`；
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

- 高亮记录仅存本机浏览器（IndexedDB kv 键 `highlights`，按文档路径分组），不写回仓库；
- 设置页「高亮数据」区可**导出 / 导入 JSON** 备份（导入按 `路径 + 原文 + 装饰` 合并去重，不覆盖本地已有）；**清除站点数据会丢失本机高亮，建议定期导出**；
- 仓库改动后无法模糊命中的高亮成为「孤儿」：记录保留、暂不渲染，原文恢复后自动重现（导出时一并导出）。

### 测试

```bash
npm test                       # 单元测试（Vitest）
npm run typecheck              # 类型检查
npm run test:e2e               # 端到端（Playwright，mock GitHub API；自动构建并起 preview）
npm run corpus -- <dir>        # 本地工具：语料体检（锚点 / 高亮 / mermaid 统计）
npm run conformance -- <file>  # 本地工具：与 GitHub 官方渲染对拍（抽查，可选）
```
