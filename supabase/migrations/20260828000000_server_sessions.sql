begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.publy_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.publy_users(id) on delete cascade,
  token_hash text not null unique,
  is_admin boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.publy_sessions enable row level security;
revoke all on public.publy_sessions from anon, authenticated;

create index if not exists publy_sessions_user_id_idx on public.publy_sessions(user_id);
create index if not exists publy_sessions_expires_at_idx on public.publy_sessions(expires_at);

create or replace function public.publy_login(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.publy_users%rowtype;
  v_token text;
begin
  select * into v_user
  from public.publy_users
  where lower(email) = lower(trim(p_email)) and is_active is true
  limit 1;

  if v_user.id is null or extensions.crypt(p_password, v_user.password_hash) <> v_user.password_hash then
    raise exception using errcode = 'P0001', message = 'INVALID_CREDENTIALS';
  end if;

  delete from public.publy_sessions where expires_at <= now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.publy_sessions(user_id, token_hash, expires_at)
  values (v_user.id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '30 days');
  update public.publy_users set last_login = now(), last_seen = now() where id = v_user.id;

  return jsonb_build_object(
    'token', v_token,
    'user', jsonb_build_object(
      'id', v_user.id, 'email', v_user.email, 'name', v_user.name,
      'plan', v_user.plan, 'app_type', v_user.app_type,
      'is_active', v_user.is_active, 'created_at', v_user.created_at,
      'last_seen', now()
    )
  );
end;
$$;

create or replace function public.publy_session_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.publy_sessions%rowtype;
  v_user public.publy_users%rowtype;
  v_quota public.publy_quotas%rowtype;
begin
  select * into v_session
  from public.publy_sessions
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and expires_at > now()
  limit 1;
  if v_session.id is null then return null; end if;

  select * into v_user from public.publy_users where id = v_session.user_id and is_active is true;
  if v_user.id is null then return null; end if;
  select * into v_quota from public.publy_quotas where user_id = v_user.id limit 1;

  update public.publy_sessions set last_seen_at = now() where id = v_session.id;
  return jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_user.id, 'email', v_user.email, 'name', v_user.name,
      'plan', v_user.plan, 'app_type', v_user.app_type,
      'is_active', v_user.is_active, 'created_at', v_user.created_at,
      'last_seen', v_user.last_seen
    ),
    'quota', case when v_quota.id is null then null else jsonb_build_object(
      'id', v_quota.id, 'user_id', v_quota.user_id,
      'total_quota', v_quota.total_quota, 'used_quota', v_quota.used_quota,
      'remaining_quota', v_quota.remaining_quota, 'reset_date', v_quota.reset_date
    ) end
  );
end;
$$;

create or replace function public.publy_logout(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.publy_sessions
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return found;
end;
$$;

create or replace function public.publy_admin_login(p_password text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_token text;
begin
  select value #>> '{}' into v_hash from public.publy_settings where key = 'admin_pw_hash' limit 1;
  if v_hash is null or extensions.crypt(p_password, v_hash) <> v_hash then
    raise exception using errcode = 'P0001', message = 'INVALID_CREDENTIALS';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.publy_sessions(user_id, token_hash, is_admin, expires_at)
  values (null, encode(extensions.digest(v_token, 'sha256'), 'hex'), true, now() + interval '12 hours');
  return v_token;
end;
$$;

create or replace function public.publy_admin_session_get(p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.publy_sessions
    where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and is_admin is true and expires_at > now()
  );
$$;

revoke all on function public.publy_login(text, text) from public;
revoke all on function public.publy_session_get(text) from public;
revoke all on function public.publy_logout(text) from public;
revoke all on function public.publy_admin_login(text) from public;
revoke all on function public.publy_admin_session_get(text) from public;
grant execute on function public.publy_login(text, text) to anon, authenticated;
grant execute on function public.publy_session_get(text) to anon, authenticated;
grant execute on function public.publy_logout(text) to anon, authenticated;
grant execute on function public.publy_admin_login(text) to anon, authenticated;
grant execute on function public.publy_admin_session_get(text) to anon, authenticated;

commit;
