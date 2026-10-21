export const NEON_SETUP_STEPS = [
  '在 Neon Console 打开项目 → Postgres database → Data API，启用并复制 API URL。',
  '在 Data API Settings 配置 JWT 提供方（JWKS URL）；也可运行 node scripts/sync-jwt.mjs 生成本地长期 JWT。',
  '在 Neon SQL Editor 执行下面的初始化 SQL（只需一次）。',
  '在 Data API Settings → CORS allowed origins 填入本站来源。',
  '回到 md-reader 的「设置 › 跨设备同步」，粘贴 URL + JWT，测试连接后保存。',
];

export const NEON_SETUP_SQL = `-- 1. 通用同步记录表
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

grant execute on function public.sync_upsert(jsonb) to authenticated;`;
