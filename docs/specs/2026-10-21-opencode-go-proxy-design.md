# OpenCode Go 接入设计（Worker 代理）

> 日期：2026-10-21 · 状态：已实现 · 关联：[记忆助手设计](2026-10-19-memory-assistant-design.md)、[代理部署指南](../../packages/opencode-proxy/README.md)
> 范围：记忆助手的 AI 评分接入 OpenCode Go；客户端自动附带 `x-opencode-session`，Worker 代理补 CORS 与 `User-Agent`。

## 1. 目标与非目标

**目标**

1. 「设置 › 记忆助手 › 模型设置」可直接填 OpenCode Go（经代理）的 Base URL / Key / 模型名。
2. 识别到 OpenCode 目标时，所有评分请求自动附带 `x-opencode-session`；一轮训练复用同一个 ID。
3. 浏览器做不到的两件事（跨域、设置 UA）由仓库内的 Cloudflare Worker 补齐。

**非目标**

- 不抽象多 Provider 能力，不接流式输出；
- 不在应用内托管 Key：Key 仍只在本机 `localStorage`，代理逐请求透传、不落库、不写日志；
- 代理不做鉴权、不共享额度，只服务个人自用。

## 2. 为什么必须经过代理

2026-10-21 对 `opencode.ai` 的实测结论：

| 限制 | 现象 | 影响 |
| --- | --- | --- |
| 跨域 | `OPTIONS /inference/go/openai/v1/chat/completions` 返回 404，响应无 `Access-Control-*` | 浏览器直连必被拦截 |
| UA | `User-Agent` 是 forbidden header | 前端 fetch 设置无效 |
| 会话 | 缺 `x-opencode-session` 时返回 `400 MissingSessionID` | 必须自动附带 |

## 3. 请求链路

```text
MemoryTrainPage → scoreAnswer()（自动加 x-opencode-session）
  → POST https://<worker>/opencode/v1/chat/completions
  → POST https://opencode.ai/inference/go/openai/v1/chat/completions
       User-Agent: opencode/latest/2.1.1/cli
       x-opencode-client: cli
       x-opencode-session: ses_…
       Authorization: Bearer oc_sk_…（原样透传）
```

应用侧配置：

| 字段 | 值 |
| --- | --- |
| Base URL | `https://<worker>/opencode/v1` |
| 模型名 | `deepseek-v4.1-flash` |
| API Key | OpenCode Console 的 `oc_sk_...` |

`/opencode` 前缀同时是「这是 OpenCode 请求」的识别标记和 Worker 的路由前缀。

## 4. 实现要点

- `isOpenCodeTarget(baseUrl)`：命中 `opencode.ai`（含子域）、路径含 `/inference/go` 或 `/zen/go`、或 Worker 的 `/opencode` 路由。
- 会话 ID：`ses_` + 26 位字母数字；`beginOpencodeSession()` 在训练页载入时调用，整轮训练复用，提升提示词缓存命中率。
- Worker 仅转发 `/opencode/*`，其他路径 404；只允许 `POST` / `GET` / `OPTIONS`。
- Worker 注入 `User-Agent`、`x-opencode-client`，透传客户端的会话头，缺失时兜底生成。
- CORS：默认 `*`；可用 `ALLOWED_ORIGINS` 收紧到 Pages 与本地开发地址。
- 上游基址、UA、来源均可用 `wrangler.toml` 的 `[vars]` 覆盖。

## 5. 流式输出与思考模式

- 请求固定带 `stream: true`；响应按 SSE 解析：以空行切分事件，逐事件累加 `delta.reasoning_content`（思考）与 `delta.content`（正式回答）。
- 服务端忽略 `stream`、直接返回一次性 JSON 时自动回退到 `message.content` / `message.reasoning_content`，不报错。
- 思考强度（`reasoningEffort`：low / high / max）随配置保存：OpenCode 与通用 OpenAI 兼容接口发 `reasoning_effort`；直连 `api.deepseek.com` 发 `chat_template_kwargs: { thinking: true, reasoning_effort }`，与 OpenCode 自身对 DeepSeek V4 的处理一致。
- 思考内容只用于展示（评分中实时显示、结果页可折叠回看），不参与 JSON 解析；评分仍只取正式回答。
- Worker 不缓冲响应体，SSE 逐块透传；应用侧不做整包等待。

## 6. 错误映射

| 状态 | 应用提示 | 常见原因 |
| --- | --- | --- |
| 401 / 403 | Key 无效或无权限 | Key 过期（重新登录不会续期，需新建） |
| 404 | URL 或模型名不存在 | Base URL 少了 `/opencode/v1`，或模型 ID 写错 |
| 403 `origin_not_allowed` | Key 无效或无权限 | 代理收紧了 `ALLOWED_ORIGINS`，当前站点不在白名单 |
| 502 `upstream_unreachable` | 网络不可用 | Worker 未部署 / 上游不可达 |

## 7. 验证

- 单测：`tests/unit/llm.test.ts`（目标识别、会话头稳定性、SSE/非流式解析、思考强度参数）、`tests/unit/opencode-proxy.test.ts`（转发、CORS、兜底、SSE 透传、错误码）、`tests/unit/llm-config-form.test.tsx`（思考强度读写）。
- 实测：`wrangler dev` 下预检返回 204；用无效 Key 请求返回 `Invalid credential` 而非 `MissingSessionID`，说明会话头与 UA 已被上游接受。
- 流式实测：本地 mock 上游每 600 ms 推一个 SSE 事件，经 Worker 后到达间隔仍约 600 ms（27.58 → 28.18 → 28.78 → 29.08），证明代理未缓冲。
