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

## 文档

- 设计方案：[`docs/specs/2026-10-18-md-reader-design.md`](docs/specs/2026-10-18-md-reader-design.md)
- 实施计划：[`docs/plans/2026-10-18-md-reader-implementation.md`](docs/plans/2026-10-18-md-reader-implementation.md)

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

### 测试

```bash
npm test                       # 单元测试（Vitest）
npm run typecheck              # 类型检查
npm run test:e2e               # 端到端（Playwright，mock GitHub API；自动构建并起 preview）
npm run corpus -- <dir>        # 本地工具：语料体检（锚点 / 高亮 / mermaid 统计）
npm run conformance -- <file>  # 本地工具：与 GitHub 官方渲染对拍（抽查，可选）
```
