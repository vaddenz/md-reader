# OpenCode Go 代理（Cloudflare Worker）

给 md-reader 的记忆助手接 OpenCode Go 用。它是一个**无状态转发层**，只做浏览器做不了的三件事：

1. 补 CORS（`opencode.ai` 的 `/chat/completions` 预检直接 404，浏览器直连必失败）；
2. 补 `User-Agent: opencode/latest/2.1.1/cli`（浏览器禁止 fetch 设置 UA）；
3. 透传 `x-opencode-session`（缺失时兜底生成），满足 Go 的路由要求。

API Key 不落库、不写日志：`Authorization` 头由浏览器逐请求带上，Worker 原样转发。

## 部署

```bash
cd packages/opencode-proxy
npm install
npx wrangler login
npx wrangler deploy
```

部署成功后会打印形如 `https://md-reader-opencode.<your-subdomain>.workers.dev` 的地址。

## 在应用里填写

设置 › 记忆助手 › 模型设置：

| 字段 | 值 |
| --- | --- |
| Base URL | `https://md-reader-opencode.<your-subdomain>.workers.dev/opencode/v1` |
| API Key | OpenCode Console 里新建的 `oc_sk_...`（**新建**，旧 Key 过期后重新登录也不会续期） |
| 模型名 | `deepseek-v4.1-flash` |

`/opencode` 前缀不能省：应用靠它识别「这是 OpenCode 请求」，从而自动附带 `x-opencode-session`；Worker 也靠它区分代理路由。

## 可选配置

在 `wrangler.toml` 的 `[vars]` 或 Cloudflare 控制台里设置：

```toml
[vars]
ALLOWED_ORIGINS = "https://vaddenz.github.io,http://localhost:5173"
UPSTREAM = "https://opencode.ai/inference/go/openai"
USER_AGENT = "opencode/latest/2.1.1/cli"
CLIENT = "cli"
```

- `ALLOWED_ORIGINS`：默认 `*`。收紧后，不在列表里的站点会收到 403。
- `UPSTREAM`：默认 Go 的 OpenAI 兼容入口。换 Provider 时只改这里，前端不用动。
- `USER_AGENT` / `CLIENT`：上游看到的客户端标识。

## 本地开发

```bash
cd packages/opencode-proxy
npm run dev          # 默认 http://127.0.0.1:8787
```

应用里 Base URL 填 `http://127.0.0.1:8787/opencode/v1`，并确认 `ALLOWED_ORIGINS` 含 `http://localhost:5173`。

## 验证

```bash
# 预检应当返回 204 且带 Access-Control-Allow-Origin
curl -i -X OPTIONS "https://<worker>/opencode/v1/chat/completions" \
  -H "Origin: https://vaddenz.github.io" \
  -H "Access-Control-Request-Method: POST"

# 不带 Key 时应当返回 401（能拿到 401 说明 CORS 和路由都通了）
curl -i -X POST "https://<worker>/opencode/v1/chat/completions" \
  -H "Origin: https://vaddenz.github.io" \
  -H "Content-Type: application/json" \
  -H "x-opencode-session: ses_probe" \
  -d '{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"ping"}]}'
```

## 注意

- 这是给个人自用的代理，存在 `workers.dev` 上即可；不要把它变成公开的中转站，务必收紧 `ALLOWED_ORIGINS`。
- OpenCode Go 的额度按模型分别计算，DeepSeek V4.1 Flash 的月度上限见 <https://opencode.ai/docs/console/go/>。
- 官方要求客户端自行标识 UA（如 `my-agent/1.0`）；本代理默认伪装成 OpenCode CLI 是应本项目需求，如果被上游策略调整影响，改 `USER_AGENT` 即可。
