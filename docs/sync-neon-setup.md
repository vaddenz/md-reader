# 跨设备同步：Neon Data API 配置指南

> 适用版本：md-reader v1.7.0
> 相关文档：[跨设备同步设计](specs/2026-10-20-data-sync-design.md) · [验收清单](acceptance-2026-10-20-data-sync.md)
> 适用范围：md-reader 的「设置 › 跨设备同步」。GitHub 内容同步（更新目录）与本文无关。

md-reader 的跨设备同步**默认关闭**，也**不经过作者的任何服务器**。只有你在「设置 › 跨设备同步」里配置并启用后，阅读进度、文本高亮、收藏、记忆 SRS、训练记录、题库偏好才会发送到你自备的 Neon Data API。

配置分五步：启用 Data API → 准备 JWT/JWKS → 执行初始化 SQL → 配置 CORS → 在应用里保存并同步。

---

## 1. 启用 Neon Data API 并复制 API URL

1. 登录 [Neon Console](https://console.neon.tech/)，打开（或新建）一个项目。
2. 选择要使用的分支（通常为 `main`）与数据库（通常为 `neondb`）。
3. 打开 **Data API**，按提示启用；首次启用时可同时勾选 **Grant public schema access**（否则要执行第 3 步 SQL 里的 `grant` 语句）。
4. 复制页面上显示的 **API URL**，形如：

   ```text
   https://ep-xxx-yyy.apirest.c-2.us-east-2.aws.neon.tech/neondb/rest/v1
   ```

   注意保留末尾的 `/rest/v1`；应用会去掉多余的尾部 `/`。

Data API 与数据库在同一 Neon 项目内，表数据存放在你的 Neon Postgres 中，作者无法访问。

---

## 2. 准备 JWT 与 JWKS

Neon Data API 用 JWT 鉴权，并用 JWKS 中的公钥验签。两条路径任选其一。

### 方式 A：已有 JWT 提供方（Auth0 / Clerk / Keycloak / Firebase 等）

1. 在提供方处创建一个用户 / 客户端，取得长期 JWT；`sub` 是该用户的唯一标识。
2. JWT 必须包含 `role` claim，值通常是 `authenticated`（Data API 用 `.role` 选择数据库角色）；缺少它时写入会返回 `403 permission denied`。
3. 在 Neon Console → **Postgres database → Data API → Settings → Authentication → Add provider**，填入提供方的 **JWKS URL**；若提供方要求 audience，再填入对应的 **JWT Audience**。
4. 把 JWT 粘贴到 md-reader 的「设置 › 跨设备同步」。

应用只解析 JWT 的 `sub`、`role` 与 `exp`（不验签），不关心签发方。

### 方式 B：仓库附带的本地脚本（个人长期 JWT）

脚本只在本机运行，使用 Node 内置 `crypto`，无额外依赖。

```bash
# 默认：sub=md-reader，有效期 3650 天
node scripts/sync-jwt.mjs

# 自定义
node scripts/sync-jwt.mjs --sub md-reader --days 3650
node scripts/sync-jwt.mjs --aud md-reader --out-dir .sync-jwt --jwks public/sync-jwks.json
node scripts/sync-jwt.mjs --help   # 退出码 0
```

参数：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--sub <id>` | `md-reader` | JWT 的 `sub`，也是 Neon 中的用户标识；必须为非空字符串 |
| `--role <role>` | `authenticated` | JWT 的 `role`；Data API 用它选择数据库角色，必须与 Data API 的 `jwt_role_claim_key`（默认 `.role`）匹配 |
| `--days <n>` | `3650` | 有效期天数（10 年）；必须为正整数 |
| `--aud <value>` | 无 | 可选 `aud`；若 Neon 侧校验 audience，填一致的值 |
| `--out-dir <dir>` | `.sync-jwt` | 私钥目录 |
| `--jwks <file>` | `public/sync-jwks.json` | 公钥 JWKS 输出路径 |
| `--help` | — | 显示用法并退出 |

`--sub` / `--role` / `--days` 非法（含裸参数、`abc`、`0`、负数、小数）时，脚本打印错误与用法到 stderr，以退出码 1 结束，并在创建任何目录或密钥之前退出。

产物与边界：

- **私钥**：`.sync-jwt/private.pem`（权限 `0600`），已加入 `.gitignore`，**绝不能提交、上传或发给任何人**。拿到私钥即可伪造任意 `sub` 的 JWT。
- **公钥 JWKS**：默认 `public/sync-jwks.json`，只含公钥（`kty/n/e` + `kid/alg/use`）。公钥可以公开，随 GitHub Pages 一起部署。
- **JWT**：只有一行，打印到 stdout；状态信息打印到 stderr。把这一行粘贴到应用即可。
- 重复运行会复用已有私钥，只重新签发 JWT；要换密钥见第 8 节。

把 JWKS 部署到可被 Neon 访问的 HTTPS 地址。使用本仓库默认的 GitHub Pages 部署时是：

```text
https://vaddenz.github.io/md-reader/sync-jwks.json
```

在 Neon 的 **Data API → Settings → Authentication → Add provider** 中填入该 JWKS URL；若在同一处配置了 **JWT Audience**，签发时用 `--aud` 填入完全一致的值（不确定就留空）。若你 fork 或自建，换成自己的域名与 `base` 路径；也可以把 `public/sync-jwks.json` 放到任意静态托管上（Neon 只需能访问到它）。

> 私钥不参与部署；GitHub Pages 只会发布 `public/` 下的产物。部署前确认 `public/sync-jwks.json` 只有公钥字段。

---

## 3. 执行初始化 SQL

在 Neon Console 的 **SQL Editor** 中执行下面的完整 SQL（只需一次；可重复执行）。应用内「设置 › 跨设备同步 › Neon 初始化」也提供同一段 SQL 和复制按钮。

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

要点：

- `user_id` 由 `request.jwt.claims` 里的 `sub` 填充（`sync_upsert` 显式取值）；RLS 使用 `auth.user_id()` 校验，二者都来自同一枚 JWT，只允许本人读写。
- `sync_upsert` 是条件写：只有 `(updated_at, device_id)` 严格更大的记录才覆盖远端，避免旧数据覆盖新数据。
- 不向 `anon` 授权；匿名请求不能读写。
- 不需要为每种数据类型建表；新增数据类型只改客户端。

---

## 4. 配置 CORS

在 Neon **Data API → Settings → CORS allowed origins** 中填入允许访问 API 的页面来源（scheme + host + port，不带路径）：

```text
https://vaddenz.github.io
http://localhost:5173
```

- 第一项是 GitHub Pages 站点；第二项是本地 `npm run dev` 开发。
- 若你 fork 到自己的账号，把第一项换成自己的 Pages 来源。
- 留空通常表示允许所有来源，功能可用但安全性更低；不建议。
- 来源不匹配时，浏览器会拦截响应，应用显示「网络不可用，或 Neon CORS 未允许当前站点」。

---

## 5. 在应用中配置

1. 打开 md-reader →「设置 › 跨设备同步」。
2. 填写 **接口地址**（第 1 步的 API URL）与 **JWT**（方式 A 的 token，或第 2 步脚本输出的那一行）。
3. 建议先点 **测试连接**：它会读取表、写入并删除一条探针记录，验证 URL、JWT、表、RLS 与 RPC。
4. 点 **保存并启用**。保存会清空拉取游标，下次同步全量拉取。
5. **自动同步默认关闭**。此时状态显示「仅手动同步」，启动、联网、页面隐藏与数据变更都不会发请求；点击 **立即同步** 才会拉取 + 推送。
6. 需要自动同步时，在状态卡打开「自动同步」开关。切换即时保存，不重置游标、不影响待推送队列。
7. 多设备（或两个浏览器 profile）填写**同一个 URL 与同一个 JWT**，数据才会汇聚到同一个 `sub` 下。

首次同步会把本机已有数据 seed 到 outbox 再上传；其他设备首次同步会拉取并恢复。删除高亮 / 取消收藏会以 tombstone 同步；「清除训练数据」用集合级 reset 标记，避免旧记录被另一台设备推回。

---

## 6. 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `401` / 「JWT 无效、已过期或没有权限」 | JWT 过期、拼写错误、签名与 JWKS 不匹配、`kid` 不在 JWKS、`sub` 为空、Neon 配置的 JWT Audience 与 token 的 `aud` 不一致 | 重新粘贴完整 JWT；用 `node scripts/sync-jwt.mjs` 重签；核对 Neon 的 JWKS 与 JWT Audience 设置；确认 JWKS 已部署且内容是最新公钥 |
| `403` | JWT 缺少 `role` / role 不是 `authenticated`，或 RLS 未允许当前 `sub` | 重新执行第 3 节完整 SQL；确认 JWT 含 `role: "authenticated"`（`node scripts/sync-jwt.mjs` 默认会加）；确认 `sub` 与 RLS 使用的 `auth.user_id()` 一致；确认已执行 `grant` 语句 |
| `404` / 「同步表不存在，请先执行初始化 SQL」 | 表或 RPC 不存在、API URL 少了 `/rest/v1`、连到了错误的分支/数据库 | 执行第 3 节 SQL；核对 API URL 的数据库名与分支 |
| 浏览器报 CORS / 「网络不可用，或 Neon CORS 未允许当前站点」 | 来源未加入 CORS、协议或端口不一致、Neon 项目休眠/冷启动超时 | 在 Data API → Settings 添加当前页面来源（含 `https://` / `http://localhost:5173`）；确认网络；冷启动稍后重试 |
| 「JWT 将在 X 天后到期」 | JWT 临近过期（30 天内） | 不阻断同步；尽快用脚本重签并更新应用中的 JWT |
| JWT 已过期 | 本地时间超过 `exp` | 重签 JWT；应用会阻止测试连接并提示过期 |
| 测试连接成功但同步失败 | 拉取/推送期间网络中断、单条 payload 损坏、其他设备写入竞争 | 查看状态卡错误与仓库结果；重试；损坏记录会被跳过，不会删除本地数据 |
| 某个仓库显示「数据库被占用」 | 该仓库的 IndexedDB 被旧标签页 / 旧 PWA 实例占用 | 关闭其他标签页或强制退出应用后重试；其他仓库会继续同步 |
| 两台设备数据不一致 | 时钟偏差导致 LWW 判旧、未点「立即同步」（自动同步关闭）、JWT/URL 不同 | 校准设备时间；手动点「立即同步」；核对两台设备的接口地址与 JWT 完全一致 |
| 删除后又出现 | 另一台设备在删除之后又写入了同一条记录（LWW 中较新者获胜） | 在需要保留删除结果的设备上重新删除并立即同步；确认两台设备时间大致准确 |

应用不会在 URL、日志或错误消息中输出 JWT，也不会显示 Neon 原始响应体。

---

## 7. 验证与排查命令

检查 JWT 的 `sub` / `exp`（不验签，仅本地查看）：

```bash
node -e "const t=process.argv[1];const p=JSON.parse(Buffer.from(t.split('.')[1],'base64url'));console.log({sub:p.sub,role:p.role,aud:p.aud,exp:new Date(p.exp*1000).toISOString()})" '<粘贴 JWT>'
```

直接请求表（应返回 `[]` 或记录；把 URL 与 JWT 换成自己的）：

```bash
curl -sS '<API_URL>/sync_records?select=scope&limit=1' \
  -H "Authorization: Bearer <JWT>"
```

请求 RPC（应返回空响应且无错误）：

```bash
curl -sS -X POST '<API_URL>/rpc/sync_upsert' \
  -H "Authorization: Bearer <JWT>" \
  -H 'Content-Type: application/json' \
  -d '{"p_records":[]}'
```

> 命令历史可能保留 JWT；个人机器上使用后注意清理。不要把 JWT 贴到公开 issue / 聊天记录。

---

## 8. 轮换密钥与 JWT

JWT 是 bearer token：拿到即可读写该 `sub` 的全部同步数据。怀疑泄露或想定期轮换时：

1. **停用**应用中的同步（或先清除配置），避免轮换期间新旧 token 混用。
2. 备份需要保留的数据（应用内可导出高亮；训练数据可导出 JSON）。
3. 删除旧私钥并生成新密钥对：

   ```bash
   rm -rf .sync-jwt
   node scripts/sync-jwt.mjs --sub md-reader --days 3650
   ```

4. 提交并部署新的 `public/sync-jwks.json`（`kid` 会变化）。
5. 在 Neon 的 Data API → Settings → Authentication 确认 JWKS URL 指向新文件；若 Neon 缓存了 JWKS，可重新保存该设置或等待缓存刷新（JWT 缓存最长寿命可在同一页调整）。
6. 回到应用「更换」JWT，粘贴新 token，测试连接 → 保存 →「立即同步」。

旧 JWT 的 `kid` 已不在 JWKS 中，验签失败，随即失效。旧 JWT 若曾在其他设备保存，需在那些设备上同样更换。

> 脚本每次只写一个公钥。若需要「新旧密钥并存、平滑过渡」，可在部署前手动把旧公钥条目临时合并进 `keys` 数组，过渡结束后再删除。

---

## 9. 隐私与数据边界

- **Neon 可见明文**：同步数据以 JSONB 明文存放在你的 Neon Postgres 中，没有端到端加密。JWT 就是数据访问凭据；请保护好 Neon 账号与 JWT。
- **只同步指定数据**：阅读进度、文本高亮、收藏、记忆 SRS、训练记录、题库偏好（`banks` / `filters`）。笔记仅预留，本期不启用。
- **永不上传**：文档正文、GitHub Token、AI Key / 模型配置、当前训练会话、打开的标签页、阅读外观与全局设置。
- **范围按仓库隔离**：每条记录带 `owner/repo@branch` scope；同账号下多个仓库各自同步、互不覆盖。
- **作者不参与**：数据只在你的浏览器与你的 Neon 之间传输，不经过 md-reader 作者的任何服务器。
- **本机凭据**：URL / JWT 只存 localStorage；界面掩码显示；不写 URL、日志或错误消息。
- **删除语义**：删除高亮、取消收藏会同步 tombstone；「清除训练数据」会写 reset 标记。Neon 上已同步的行不会因为清除本机配置而自动删除；如需彻底清空，请在 Neon SQL Editor 中自行 `delete from public.sync_records`（或删除项目）。

---

## 10. 已知限制

- **时钟偏差**：冲突按「逐记录最后写入获胜」合并，时间戳来自设备本地时钟；严重偏差时较旧编辑可能获胜。
- **长期 JWT**：默认 10 年有效，泄露风险高于短期 token；靠 RLS、CORS 与轮换降低影响。
- **Neon 免费额度 / 冷启动**：首次请求可能较慢；单请求 30 秒超时，超时会提示网络错误。
- **后台同步**：不做 Service Worker 后台同步；页面隐藏后的最后一批同步是 best-effort。
- **仓库改名 / 换分支**：scope 随之变化，旧 scope 的数据不会自动迁移。
- **导入旧训练备份**：若导入记录的 `ts` / `lastAt` 早于 reset 标记，其他设备会按 reset 过滤；本期不实现「导入即撤销 reset」。
- **删除 Neon 项目 / 重置数据**：应用不会自动重建远端 schema；需重新执行初始化 SQL 并重新配置。
